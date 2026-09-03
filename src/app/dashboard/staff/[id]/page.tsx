"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  CircleUserRound,
  Clock3,
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  UserCheck,
  UserRound,
  Users,
  WalletCards,
  XCircle,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Staff = {
  id: string;
  school_id: string;
  user_id: string | null;
  employee_no: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  gender: string | null;
  date_of_birth: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  joining_date: string | null;
  department: string | null;
  designation: string | null;
  employment_type: string | null;
  status: string | null;
  photo_url: string | null;
};

type SchoolUser = {
  user_id: string;
  school_id: string;
  role: string;
  is_active: boolean;
};

type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
};

type LoginAccount = SchoolUser & {
  profile?: Profile;
};

function formatName(staff: Staff | null) {
  if (!staff) return "Staff Member";

  return [staff.first_name, staff.middle_name, staff.last_name]
    .filter(Boolean)
    .join(" ");
}

function formatDate(value: string | null) {
  if (!value) return "â€”";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function capitalize(value: string | null) {
  if (!value) return "â€”";

  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);

  if (parts.length === 1) {
    return parts[0]?.slice(0, 2).toUpperCase() || "ST";
  }

  return `${parts[0]?.[0] || ""}${
    parts[parts.length - 1]?.[0] || ""
  }`.toUpperCase();
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </p>

        <p className="mt-1 break-words text-sm font-medium text-slate-800">
          {value || "â€”"}
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon: typeof BriefcaseBusiness;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
            <Icon className="h-4 w-4" />
          </div>

          <h2 className="text-sm font-semibold text-slate-900">
            {title}
          </h2>
        </div>

        {action}
      </div>

      <div className="p-5">{children}</div>
    </section>
  );
}

export default function StaffProfilePage() {
  const params = useParams();
  const router = useRouter();

  const supabase = useMemo(() => createClient(), []);

  const staffId = Array.isArray(params.id)
    ? params.id[0]
    : params.id;

  const [staff, setStaff] = useState<Staff | null>(null);

  const [schoolUsers, setSchoolUsers] = useState<LoginAccount[]>(
    []
  );

  const [assignedAccount, setAssignedAccount] =
    useState<LoginAccount | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  /*
   * CREATE LOGIN ACCOUNT
   */
  const [showCreateLogin, setShowCreateLogin] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");

  const [loginPassword, setLoginPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [creatingLogin, setCreatingLogin] = useState(false);

  /*
   * Store credentials only for the current successful
   * creation result.
   */
  const [createdLogin, setCreatedLogin] = useState<{
    email: string;
    password: string;
  } | null>(null);

  const loadStaff = useCallback(async () => {
    if (!staffId) return;

    setLoading(true);
    setError("");

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) {
        throw authError;
      }

      if (!user) {
        router.push("/login");
        return;
      }

      /*
       * Find active school for current admin.
       */
      const { data: schoolUser, error: schoolError } =
        await supabase
          .from("school_users")
          .select("school_id, role, is_active")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

      if (schoolError) {
        throw schoolError;
      }

      if (!schoolUser) {
        throw new Error(
          "No active school was found for this account."
        );
      }

      /*
       * Load staff.
       */
      const { data: staffRow, error: staffError } =
        await supabase
          .from("staff")
          .select(
            `
              id,
              school_id,
              user_id,
              employee_no,
              first_name,
              middle_name,
              last_name,
              gender,
              date_of_birth,
              phone,
              email,
              address,
              city,
              joining_date,
              department,
              designation,
              employment_type,
              status,
              photo_url
            `
          )
          .eq("id", staffId)
          .eq("school_id", schoolUser.school_id)
          .maybeSingle();

      if (staffError) {
        throw staffError;
      }

      if (!staffRow) {
        throw new Error("Staff member not found.");
      }

      setStaff(staffRow);

      /*
       * Load active school login accounts.
       */
      const { data: users, error: usersError } =
        await supabase
          .from("school_users")
          .select(
            "user_id, school_id, role, is_active"
          )
          .eq("school_id", schoolUser.school_id)
          .eq("is_active", true)
          .order("role", {
            ascending: true,
          });

      if (usersError) {
        throw usersError;
      }

      const userIds = (users || []).map(
        (item) => item.user_id
      );

      let profiles: Profile[] = [];

      if (userIds.length > 0) {
        const { data: profileRows, error: profileError } =
          await supabase
            .from("profiles")
            .select("id, full_name, phone")
            .in("id", userIds);

        if (profileError) {
          throw profileError;
        }

        profiles = profileRows || [];
      }

      const profileMap = new Map(
        profiles.map((profile) => [
          profile.id,
          profile,
        ])
      );

      const accounts: LoginAccount[] = (
        users || []
      ).map((item) => ({
        ...item,
        profile: profileMap.get(item.user_id),
      }));

      setSchoolUsers(accounts);

      if (staffRow.user_id) {
        const currentAccount =
          accounts.find(
            (account) =>
              account.user_id === staffRow.user_id
          ) || null;

        setAssignedAccount(currentAccount);
      } else {
        setAssignedAccount(null);
      }
    } catch (err: any) {
      console.error(err);

      setError(
        err?.message ||
          "Failed to load staff profile."
      );
    } finally {
      setLoading(false);
    }
  }, [router, staffId, supabase]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  /*
   * CREATE TEACHER LOGIN
   */
  const createTeacherLogin = async () => {
    if (!staff) return;

    setCreatingLogin(true);
    setError("");
    setSuccess("");

    try {
      const email = loginEmail.trim().toLowerCase();

      if (!email) {
        throw new Error(
          "Please enter a login email."
        );
      }

      if (!email.includes("@")) {
        throw new Error(
          "Please enter a valid email address."
        );
      }

      if (loginPassword.length < 8) {
        throw new Error(
          "Password must contain at least 8 characters."
        );
      }

      /*
       * Get current admin session.
       */
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error(
          "Your login session has expired. Please log in again."
        );
      }

      /*
       * Call our server-side API.
       *
       * The API uses Supabase service role securely
       * on the server.
       */
      const response = await fetch(
        "/api/staff/create-login",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${session.access_token}`,
          },

          body: JSON.stringify({
            staff_id: staff.id,
            email,
            password: loginPassword,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.error ||
            "Failed to create login account."
        );
      }

      if (!result?.success) {
        throw new Error(
          "Login account was not created."
        );
      }

      /*
       * Show credentials only after successful creation.
       */
      setCreatedLogin({
        email: result.email,
        password: loginPassword,
      });

      setLoginEmail("");
      setLoginPassword("");
      setShowPassword(false);
      setShowCreateLogin(false);

      setSuccess(
        "Teacher login account created successfully."
      );

      /*
       * Reload staff so staff.user_id is visible.
       */
      await loadStaff();
    } catch (err: any) {
      console.error(err);

      setError(
        err?.message ||
          "Failed to create login account."
      );
    } finally {
      setCreatingLogin(false);
    }
  };

  /*
   * Copy credentials.
   */
  const copyCredentials = async () => {
    if (!createdLogin) return;

    try {
      await navigator.clipboard.writeText(
        `Login Email: ${createdLogin.email}\nTemporary Password: ${createdLogin.password}`
      );

      setSuccess(
        "Login credentials copied to clipboard."
      );
    } catch {
      setError(
        "Unable to copy credentials."
      );
    }
  };

  /*
   * LOADING
   */
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-7xl animate-pulse">
          <div className="h-7 w-48 rounded-lg bg-slate-200" />

          <div className="mt-6 h-44 rounded-2xl bg-white" />

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="h-72 rounded-2xl bg-white" />

            <div className="h-72 rounded-2xl bg-white" />
          </div>
        </div>
      </div>
    );
  }

  /*
   * ERROR
   */
  if (error && !staff) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <XCircle className="mx-auto h-12 w-12 text-red-500" />

          <h1 className="mt-4 text-lg font-bold text-slate-900">
            Unable to load staff
          </h1>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            {error}
          </p>

          <Link
            href="/dashboard/staff"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Staff
          </Link>
        </div>
      </div>
    );
  }

  if (!staff) {
    return null;
  }

  const name = formatName(staff);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">

        {/* =========================================
            BACK
        ========================================== */}
        <div className="mb-5">
          <Link
            href="/dashboard/staff"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Staff
          </Link>
        </div>

        {/* =========================================
            PROFILE HEADER
        ========================================== */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="h-24 bg-gradient-to-r from-slate-950 via-slate-800 to-slate-700" />

          <div className="px-5 pb-6 sm:px-7">
            <div className="-mt-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">

              <div className="flex items-end gap-4">

                {staff.photo_url ? (
                  <img
                    src={staff.photo_url}
                    alt={name}
                    className="h-20 w-20 rounded-2xl border-4 border-white object-cover shadow-md"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl border-4 border-white bg-slate-100 text-xl font-bold text-slate-600 shadow-md">
                    {initials(name)}
                  </div>
                )}

                <div className="pb-1">

                  <div className="flex flex-wrap items-center gap-2">

                    <h1 className="text-xl font-bold text-slate-900">
                      {name}
                    </h1>

                    {staff.status === "active" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Active
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {capitalize(staff.status)}
                      </span>
                    )}

                  </div>

                  <p className="mt-1 text-sm text-slate-500">
                    {staff.designation ||
                      "Staff Member"}

                    {staff.department
                      ? ` â€¢ ${staff.department}`
                      : ""}
                  </p>

                  {staff.employee_no && (
                    <p className="mt-1 text-xs font-medium text-slate-400">
                      Employee No:{" "}
                      {staff.employee_no}
                    </p>
                  )}

                </div>
              </div>

              {/* Quick actions */}
              <div className="flex flex-wrap gap-2">

                <Link
                  href="/dashboard/staff/attendance"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Clock3 className="h-4 w-4" />
                  Attendance
                </Link>

                <Link
                  href={`/dashboard/staff/${staff.id}/salary`}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <WalletCards className="h-4 w-4" />
                  Salary
                </Link>

                <Link
                  href={`/dashboard/staff/${staff.id}/payslip`}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  <WalletCards className="h-4 w-4" />
                  Payslip
                </Link>

              </div>
            </div>
          </div>
        </div>

        {/* =========================================
            ALERTS
        ========================================== */}

        {error && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />

            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />

            <span>{success}</span>
          </div>
        )}

        {/* =========================================
            MAIN GRID
        ========================================== */}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">

          {/* =======================================
              PERSONAL INFORMATION
          ======================================== */}

          <Section
            title="Personal Information"
            icon={CircleUserRound}
            action={
              <Link
                href={`/dashboard/staff/${staff.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Edit
              </Link>
            }
          >
            <div className="grid gap-5 sm:grid-cols-2">

              <InfoItem
                icon={UserRound}
                label="Gender"
                value={capitalize(staff.gender)}
              />

              <InfoItem
                icon={CalendarDays}
                label="Date of Birth"
                value={formatDate(
                  staff.date_of_birth
                )}
              />

              <InfoItem
                icon={Phone}
                label="Phone"
                value={staff.phone || "â€”"}
              />

              <InfoItem
                icon={Mail}
                label="Email"
                value={staff.email || "â€”"}
              />

              <div className="sm:col-span-2">
                <InfoItem
                  icon={MapPin}
                  label="Address"
                  value={
                    [
                      staff.address,
                      staff.city,
                    ]
                      .filter(Boolean)
                      .join(", ") || "â€”"
                  }
                />
              </div>

            </div>
          </Section>

          {/* =======================================
              EMPLOYMENT INFORMATION
          ======================================== */}

          <Section
            title="Employment Information"
            icon={BriefcaseBusiness}
          >
            <div className="grid gap-5 sm:grid-cols-2">

              <InfoItem
                icon={Users}
                label="Department"
                value={
                  staff.department || "â€”"
                }
              />

              <InfoItem
                icon={BriefcaseBusiness}
                label="Designation"
                value={
                  staff.designation || "â€”"
                }
              />

              <InfoItem
                icon={UserCheck}
                label="Employment Type"
                value={capitalize(
                  staff.employment_type
                )}
              />

              <InfoItem
                icon={CalendarDays}
                label="Joining Date"
                value={formatDate(
                  staff.joining_date
                )}
              />

              <InfoItem
                icon={ShieldCheck}
                label="Employee Number"
                value={
                  staff.employee_no || "â€”"
                }
              />

              <InfoItem
                icon={CheckCircle2}
                label="Status"
                value={capitalize(
                  staff.status
                )}
              />

            </div>
          </Section>

          {/* =======================================
              LOGIN ACCOUNT
          ======================================== */}

          <Section
            title="Login Account"
            icon={ShieldCheck}
          >

            {/* CREATED LOGIN RESULT */}

            {createdLogin && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">

                <div className="flex items-start gap-3">

                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">

                    <p className="text-sm font-bold text-emerald-900">
                      Login Account Created
                    </p>

                    <p className="mt-1 text-xs leading-5 text-emerald-700">
                      Give these credentials to the
                      teacher.
                    </p>

                    {/* EMAIL */}

                    <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-3">

                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-slate-400" />

                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          Login Email
                        </p>
                      </div>

                      <p className="mt-1 break-all text-sm font-bold text-slate-900">
                        {createdLogin.email}
                      </p>

                    </div>

                    {/* PASSWORD */}

                    <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3">

                      <div className="flex items-center justify-between">

                        <div className="flex items-center gap-2">
                          <KeyRound className="h-4 w-4 text-slate-400" />

                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            Temporary Password
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setShowPassword(
                              (value) => !value
                            )
                          }
                          className="text-slate-400 hover:text-slate-700"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>

                      </div>

                      <p className="mt-1 break-all font-mono text-sm font-bold text-slate-900">
                        {showPassword
                          ? createdLogin.password
                          : "â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"}
                      </p>

                    </div>

                    {/* COPY */}

                    <button
                      type="button"
                      onClick={copyCredentials}
                      className="mt-4 w-full rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                    >
                      Copy Login Details
                    </button>

                    <p className="mt-3 text-xs leading-5 text-emerald-700">
                      Ask the teacher to change the
                      temporary password after the first
                      login.
                    </p>

                  </div>
                </div>
              </div>
            )}

            {/* EXISTING ACCOUNT */}

            {!createdLogin &&
              staff.user_id && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">

                  <div className="flex items-start gap-3">

                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                      <UserCheck className="h-5 w-5" />
                    </div>

                    <div className="min-w-0">

                      <p className="text-sm font-bold text-emerald-900">
                        Login Account Active
                      </p>

                      <p className="mt-1 text-xs leading-5 text-emerald-700">
                        This staff member is connected
                        to a login account.
                      </p>

                      {assignedAccount && (
                        <div className="mt-3">

                          <p className="text-sm font-bold text-slate-900">
                            {assignedAccount.profile
                              ?.full_name ||
                              "Login Account"}
                          </p>

                          <div className="mt-2 flex flex-wrap gap-2">

                            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                              Role:{" "}
                              {capitalize(
                                assignedAccount.role
                              )}
                            </span>

                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                              Active
                            </span>

                          </div>

                        </div>
                      )}

                      <Link
                        href={`/dashboard/staff/${staff.id}/reset-password`}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <KeyRound className="h-4 w-4" />
                        Reset Staff Password
                      </Link>
                    </div>
                  </div>
                </div>
              )}

                      <Link
                        href={`/dashboard/staff/${staff.id}/reset-password`}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
                      >
                        <KeyRound className="h-4 w-4" />
                        Reset Password
                      </Link>
            {/* NO ACCOUNT */}

            {!createdLogin &&
              !staff.user_id && (
                <>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">

                    <div className="flex items-start gap-3">

                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                        <ShieldCheck className="h-5 w-5" />
                      </div>

                      <div>

                        <p className="text-sm font-bold text-amber-900">
                          No Login Account
                        </p>

                        <p className="mt-1 text-xs leading-5 text-amber-700">
                          Create a login account for this
                          teacher. The account will
                          automatically be connected to this
                          staff member.
                        </p>

                      </div>
                    </div>
                  </div>

                  {/* CREATE BUTTON */}

                  {!showCreateLogin && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateLogin(true);
                        setError("");
                        setSuccess("");

                        if (staff.email) {
                          setLoginEmail(
                            staff.email
                          );
                        }
                      }}
                      className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800"
                    >
                      <UserCheck className="h-4 w-4" />

                      Create Login Account
                    </button>
                  )}

                  {/* CREATE FORM */}

                  {showCreateLogin && (
                    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5">

                      <div className="mb-5">

                        <div className="flex items-center gap-2">
                          <UserCheck className="h-5 w-5 text-slate-700" />

                          <h3 className="text-sm font-bold text-slate-900">
                            Create Teacher Login
                          </h3>
                        </div>

                        <p className="mt-2 text-xs leading-5 text-slate-500">
                          This account will automatically
                          be linked to:
                        </p>

                        <p className="mt-1 text-sm font-bold text-slate-900">
                          {name}
                        </p>

                      </div>

                      {/* EMAIL */}

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Login Email
                        </label>

                        <div className="relative">

                          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                          <input
                            type="email"
                            value={loginEmail}
                            onChange={(event) =>
                              setLoginEmail(
                                event.target.value
                              )
                            }
                            placeholder="teacher@school.com"
                            disabled={creatingLogin}
                            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3.5 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-100"
                          />

                        </div>
                      </div>

                      {/* PASSWORD */}

                      <div className="mt-4">

                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Temporary Password
                        </label>

                        <div className="relative">

                          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                          <input
                            type={
                              showPassword
                                ? "text"
                                : "password"
                            }
                            value={loginPassword}
                            onChange={(event) =>
                              setLoginPassword(
                                event.target.value
                              )
                            }
                            placeholder="Minimum 8 characters"
                            disabled={creatingLogin}
                            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-11 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-100"
                          />

                          <button
                            type="button"
                            onClick={() =>
                              setShowPassword(
                                (value) => !value
                              )
                            }
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>

                        </div>

                        <p className="mt-1.5 text-[11px] text-slate-400">
                          Minimum 8 characters.
                        </p>

                      </div>

                      {/* ACTIONS */}

                      <div className="mt-5 flex gap-2">

                        <button
                          type="button"
                          onClick={() => {
                            setShowCreateLogin(
                              false
                            );

                            setLoginEmail("");

                            setLoginPassword("");

                            setShowPassword(false);

                            setError("");
                          }}
                          disabled={creatingLogin}
                          className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>

                        <button
                          type="button"
                          onClick={createTeacherLogin}
                          disabled={
                            creatingLogin ||
                            !loginEmail.trim() ||
                            loginPassword.length < 8
                          }
                          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {creatingLogin ? (
                            <>
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />

                              Creating...
                            </>
                          ) : (
                            <>
                              <UserCheck className="h-4 w-4" />

                              Create Account
                            </>
                          )}
                        </button>

                      </div>

                    </div>
                  )}
                </>
              )}
          </Section>

          {/* =======================================
              ATTENDANCE ACCESS
          ======================================== */}

          <Section
            title="Attendance Access"
            icon={Clock3}
          >

            <div
              className={`rounded-2xl border p-5 ${
                staff.user_id
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >

              <div className="flex items-start gap-3">

                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                    staff.user_id
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {staff.user_id ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <ShieldCheck className="h-5 w-5" />
                  )}
                </div>

                <div>

                  <p className="text-sm font-bold text-slate-900">
                    {staff.user_id
                      ? "Ready for Attendance"
                      : "Attendance Access Not Ready"}
                  </p>

                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {staff.user_id
                      ? "This teacher has a login account and can be automatically identified for GPS attendance."
                      : "Create a login account before this teacher can use GPS attendance."}
                  </p>

                </div>

              </div>

            </div>

            <Link
              href="/dashboard/staff/attendance"
              className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition ${
                staff.user_id
                  ? "bg-slate-900 text-white hover:bg-slate-800"
                  : "pointer-events-none bg-slate-100 text-slate-400"
              }`}
            >
              <Clock3 className="h-4 w-4" />
              Open Daily Attendance
            </Link>

          </Section>
        </div>

        {/* =========================================
            STAFF MANAGEMENT
        ========================================== */}

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

          <h2 className="text-sm font-semibold text-slate-900">
            Staff Management
          </h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

            <Link
              href="/dashboard/staff/attendance"
              className="rounded-xl border border-slate-200 p-4 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <Clock3 className="h-5 w-5 text-slate-600" />

              <p className="mt-3 text-sm font-semibold text-slate-900">
                Daily Attendance
              </p>

              <p className="mt-1 text-xs text-slate-500">
                GPS check-in and check-out
              </p>
            </Link>

            <Link
              href={`/dashboard/staff/${staff.id}/salary`}
              className="rounded-xl border border-slate-200 p-4 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <WalletCards className="h-5 w-5 text-slate-600" />

              <p className="mt-3 text-sm font-semibold text-slate-900">
                Salary
              </p>

              <p className="mt-1 text-xs text-slate-500">
                Salary structure and allowances
              </p>
            </Link>

            <Link
              href={`/dashboard/staff/${staff.id}/payslip`}
              className="rounded-xl border border-slate-200 p-4 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <WalletCards className="h-5 w-5 text-slate-600" />

              <p className="mt-3 text-sm font-semibold text-slate-900">
                Payslips
              </p>

              <p className="mt-1 text-xs text-slate-500">
                View staff payslips
              </p>
            </Link>

            <Link
              href="/dashboard/payroll"
              className="rounded-xl border border-slate-200 p-4 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <BriefcaseBusiness className="h-5 w-5 text-slate-600" />

              <p className="mt-3 text-sm font-semibold text-slate-900">
                Payroll
              </p>

              <p className="mt-1 text-xs text-slate-500">
                School payroll processing
              </p>
            </Link>

          </div>
        </div>

        {/* =========================================
            SECURITY NOTICE
        ========================================== */}

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-100 p-5">

          <div className="flex items-start gap-3">

            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" />

            <div>

              <p className="text-sm font-semibold text-slate-800">
                Secure Staff Login
              </p>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                The teacher login is connected directly to the
                staff record. After login, the system can identify
                the exact staff member automatically without asking
                the teacher to select a name.
              </p>

            </div>

          </div>

        </div>
      </div>
    </div>
  );
}



