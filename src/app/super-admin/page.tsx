"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type School = {
  id: string;
  name: string;
  code: string | null;
  school_code: string | null;
  status: string;
  plan_code: string | null;
  student_limit: number | null;
  expires_on: string | null;
};

export default function SuperAdminPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");

  const [schools, setSchools] = useState<School[]>(
    []
  );

  const [showCreate, setShowCreate] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState("");

  const [successMessage, setSuccessMessage] =
    useState("");

  // --------------------------------------------------
  // FORM
  // --------------------------------------------------

  const [schoolName, setSchoolName] =
    useState("");

  const [schoolCode, setSchoolCode] =
    useState("");

  const [schoolEmail, setSchoolEmail] =
    useState("");

  const [schoolPhone, setSchoolPhone] =
    useState("");

  const [studentLimit, setStudentLimit] =
    useState("300");

  const [ownerName, setOwnerName] =
    useState("");

  const [ownerEmail, setOwnerEmail] =
    useState("");

  const [ownerPhone, setOwnerPhone] =
    useState("");

  const [ownerPassword, setOwnerPassword] =
    useState("");

  // --------------------------------------------------
  // LOAD ADMIN
  // --------------------------------------------------

  useEffect(() => {
    let active = true;

    async function loadAdmin() {
      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
          router.replace(
            "/super-admin/login"
          );
          return;
        }

        const {
          data: profile,
          error: profileError,
        } = await supabase
          .from("user_profiles")
          .select(
            "full_name, platform_role, is_active"
          )
          .eq("id", user.id)
          .maybeSingle();

        if (
          profileError ||
          !profile ||
          profile.platform_role !==
            "super_admin" ||
          profile.is_active !== true
        ) {
          await supabase.auth.signOut();

          router.replace(
            "/super-admin/login"
          );

          return;
        }

        if (!active) return;

        setUserEmail(
          user.email || ""
        );

        setUserName(
          profile.full_name ||
            user.email?.split("@")[0] ||
            "Super Admin"
        );

        await loadSchools();
      } catch (error) {
        console.error(
          "LOAD ADMIN ERROR:",
          error
        );

        router.replace(
          "/super-admin/login"
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadAdmin();

    return () => {
      active = false;
    };
  }, []);

  // --------------------------------------------------
  // LOAD SCHOOLS
  // --------------------------------------------------

  async function loadSchools() {
    const {
      data,
      error,
    } = await supabase
      .from("schools")
      .select(
        "id,name,code,school_code,status,plan_code,student_limit,expires_on"
      )
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error(
        "LOAD SCHOOLS ERROR:",
        error
      );

      return;
    }

    setSchools(
      (data || []) as School[]
    );
  }

  // --------------------------------------------------
  // OPEN CREATE MODAL
  // --------------------------------------------------

  function openCreateSchool() {
    setErrorMessage("");
    setSuccessMessage("");

    setSchoolName("");
    setSchoolCode("");
    setSchoolEmail("");
    setSchoolPhone("");

    setStudentLimit("300");

    setOwnerName("");
    setOwnerEmail("");
    setOwnerPhone("");
    setOwnerPassword("");

    setShowCreate(true);
  }

  // --------------------------------------------------
  // CLOSE CREATE MODAL
  // --------------------------------------------------

  function closeCreateSchool() {
    if (creating) return;

    setShowCreate(false);
    setErrorMessage("");
  }

  // --------------------------------------------------
  // CREATE SCHOOL
  // --------------------------------------------------

  async function handleCreateSchool(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");

    if (!schoolName.trim()) {
      setErrorMessage(
        "Please enter the school name."
      );
      return;
    }

    if (!schoolCode.trim()) {
      setErrorMessage(
        "Please enter the school code."
      );
      return;
    }

    if (!ownerName.trim()) {
      setErrorMessage(
        "Please enter the owner name."
      );
      return;
    }

    if (!ownerEmail.trim()) {
      setErrorMessage(
        "Please enter the owner email."
      );
      return;
    }

    if (ownerPassword.length < 8) {
      setErrorMessage(
        "Owner password must be at least 8 characters."
      );
      return;
    }

    setCreating(true);

    try {
      // ---------------------------------------------
      // GET CURRENT SESSION
      // ---------------------------------------------

      const {
        data: sessionData,
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      const session =
        sessionData.session;

      if (!session) {
        throw new Error(
          "Your session has expired. Please sign in again."
        );
      }

      // ---------------------------------------------
      // SUPABASE PUBLIC KEY
      // ---------------------------------------------

      const publishableKey =
        process.env
          .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

      if (!publishableKey) {
        throw new Error(
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing from .env.local."
        );
      }

      // ---------------------------------------------
      // DIRECT EDGE FUNCTION CALL
      // ---------------------------------------------

      const controller =
        new AbortController();

      const timeoutId =
        window.setTimeout(() => {
          controller.abort();
        }, 30000);

      const response =
        await fetch(
          "https://fwalrrwjtqgpirfiraso.supabase.co/functions/v1/create-school",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${session.access_token}`,

              apikey:
                publishableKey,
            },

            body: JSON.stringify({
              school_name:
                schoolName.trim(),

              school_code:
                schoolCode
                  .trim()
                  .toUpperCase(),

              email:
                schoolEmail.trim() ||
                null,

              phone:
                schoolPhone.trim() ||
                null,

              plan_code:
                "starter",

              student_limit:
                Number(
                  studentLimit || "300"
                ),

              owner_name:
                ownerName.trim(),

              owner_email:
                ownerEmail
                  .trim()
                  .toLowerCase(),

              owner_phone:
                ownerPhone.trim() ||
                null,

              owner_password:
                ownerPassword,
            }),

            signal:
              controller.signal,
          }
        );

      window.clearTimeout(
        timeoutId
      );

      // ---------------------------------------------
      // READ RESPONSE
      // ---------------------------------------------

      const text =
        await response.text();

      let result: {
        success?: boolean;
        error?: string;
        message?: string;
      } = {};

      try {
        result = text
          ? JSON.parse(text)
          : {};
      } catch {
        result = {
          error: text,
        };
      }

      console.log(
        "CREATE SCHOOL HTTP STATUS:",
        response.status
      );

      console.log(
        "CREATE SCHOOL RESPONSE:",
        result
      );

      // ---------------------------------------------
      // ERROR
      // ---------------------------------------------

      if (!response.ok) {
        throw new Error(
          result.error ||
            result.message ||
            `Server returned HTTP ${response.status}.`
        );
      }

      if (
        result.success === false
      ) {
        throw new Error(
          result.error ||
            "School creation failed."
        );
      }

      // ---------------------------------------------
      // SUCCESS
      // ---------------------------------------------

      setSuccessMessage(
        "School and owner created successfully."
      );

      await loadSchools();

      // Clear form

      setSchoolName("");
      setSchoolCode("");
      setSchoolEmail("");
      setSchoolPhone("");

      setStudentLimit("300");

      setOwnerName("");
      setOwnerEmail("");
      setOwnerPhone("");
      setOwnerPassword("");

      // Close after success

      window.setTimeout(() => {
        setShowCreate(false);
        setSuccessMessage("");
      }, 1200);
    } catch (error) {
      console.error(
        "CREATE SCHOOL ERROR:",
        error
      );

      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        setErrorMessage(
          "The request timed out after 30 seconds. Check the create-school Edge Function logs."
        );
      } else {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to create school."
        );
      }
    } finally {
      setCreating(false);
    }
  }

  // --------------------------------------------------
  // SIGN OUT
  // --------------------------------------------------

  async function handleSignOut() {
    if (signingOut) return;

    setSigningOut(true);

    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error(
        "SIGN OUT ERROR:",
        error
      );
    }

    window.location.href =
      "/super-admin/login";
  }

  // --------------------------------------------------
  // STATS
  // --------------------------------------------------

  const activeSchools =
    schools.filter(
      (school) =>
        school.status === "active"
    ).length;

  const trialSchools =
    schools.filter(
      (school) =>
        school.status === "trial"
    ).length;

  const expiringSoon =
    schools.filter((school) => {
      if (!school.expires_on) {
        return false;
      }

      const expiry =
        new Date(
          school.expires_on
        ).getTime();

      const days =
        (expiry - Date.now()) /
        86400000;

      return (
        days >= 0 &&
        days <= 30
      );
    }).length;

  // --------------------------------------------------
  // LOADING
  // --------------------------------------------------

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="rounded-2xl bg-white px-8 py-6 shadow">
          <p className="text-sm text-slate-600">
            Loading Super Admin...
          </p>
        </div>
      </main>
    );
  }

  // --------------------------------------------------
  // DASHBOARD
  // --------------------------------------------------

  return (
    <main className="min-h-screen bg-slate-100">
      {/* HEADER */}

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Super Admin
            </h1>

            <p className="text-sm text-blue-600">
              School SaaS Administration
            </p>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {signingOut
              ? "Signing Out..."
              : "Sign Out"}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* WELCOME */}

        <section className="rounded-3xl bg-blue-600 p-7 text-white shadow-lg">
          <p className="text-sm text-blue-100">
            Welcome back
          </p>

          <h2 className="mt-1 text-3xl font-bold">
            {userName}
          </h2>

          <p className="mt-2 text-sm text-blue-100">
            {userEmail}
          </p>
        </section>

        {/* STATS */}

        <section className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Schools"
            value={schools.length}
          />

          <StatCard
            title="Active Schools"
            value={activeSchools}
          />

          <StatCard
            title="Trial Schools"
            value={trialSchools}
          />

          <StatCard
            title="Expiring Soon"
            value={expiringSoon}
          />
        </section>

        {/* MANAGEMENT */}

        <section className="mt-7 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">
              School Management
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Create and manage customer schools.
            </p>

            <button
              type="button"
              onClick={
                openCreateSchool
              }
              className="mt-6 cursor-pointer rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-200 hover:bg-blue-700"
            >
              + Create School
            </button>
          </div>

          {/* ADMIN */}

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">
              Admin Account
            </h2>

            <div className="mt-5 rounded-xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Email
              </p>

              <p className="mt-1 text-sm font-medium text-slate-900">
                {userEmail}
              </p>

              <p className="mt-5 text-xs uppercase tracking-wide text-slate-400">
                Role
              </p>

              <p className="mt-1 text-sm font-medium text-blue-600">
                Super Administrator
              </p>
            </div>
          </div>
        </section>

        {/* SCHOOL LIST */}

        <section className="mt-7 rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Schools
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Schools created in your SaaS.
              </p>
            </div>

            <button
              type="button"
              onClick={
                loadSchools
              }
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>

          {schools.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-10 text-center">
              <p className="font-medium text-slate-700">
                No schools created yet.
              </p>

              <p className="mt-1 text-sm text-slate-500">
                Click "+ Create School" to add your first school.
              </p>
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[700px] text-left">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-xs uppercase text-slate-400">
                      School
                    </th>

                    <th className="px-4 py-3 text-xs uppercase text-slate-400">
                      Code
                    </th>

                    <th className="px-4 py-3 text-xs uppercase text-slate-400">
                      Plan
                    </th>

                    <th className="px-4 py-3 text-xs uppercase text-slate-400">
                      Limit
                    </th>

                    <th className="px-4 py-3 text-xs uppercase text-slate-400">
                      Status
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {schools.map(
                    (school) => (
                      <tr
                        key={school.id}
                        className="border-b border-slate-100"
                      >
                        <td className="px-4 py-4 font-semibold text-slate-900">
                          {school.name}
                        </td>

                        <td className="px-4 py-4 text-sm text-slate-600">
                          {school.code ||
                            school.school_code ||
                            "-"}
                        </td>

                        <td className="px-4 py-4 text-sm capitalize text-slate-600">
                          {school.plan_code ||
                            "starter"}
                        </td>

                        <td className="px-4 py-4 text-sm text-slate-600">
                          {school.student_limit ||
                            300}
                        </td>

                        <td className="px-4 py-4">
                          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                            {school.status}
                          </span>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* ==================================================
          CREATE SCHOOL MODAL
      ================================================== */}

      {showCreate && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 px-4 py-6"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget &&
              !creating
            ) {
              closeCreateSchool();
            }
          }}
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            {/* MODAL HEADER */}

            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  Create School
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Create school and owner login.
                </p>
              </div>

              <button
                type="button"
                onClick={
                  closeCreateSchool
                }
                disabled={creating}
                className="text-2xl text-slate-500 hover:text-slate-900 disabled:opacity-50"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={
                handleCreateSchool
              }
              className="p-6"
            >
              {/* ERROR */}

              {errorMessage && (
                <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-sm font-medium text-red-700">
                    {errorMessage}
                  </p>
                </div>
              )}

              {/* SUCCESS */}

              {successMessage && (
                <div className="mb-5 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                  <p className="text-sm font-medium text-green-700">
                    {successMessage}
                  </p>
                </div>
              )}

              {/* SCHOOL INFORMATION */}

              <h3 className="font-bold text-slate-900">
                School Information
              </h3>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Input
                  label="School Name *"
                  value={schoolName}
                  onChange={
                    setSchoolName
                  }
                  placeholder="Digi School"
                  disabled={creating}
                />

                <Input
                  label="School Code *"
                  value={schoolCode}
                  onChange={(value) =>
                    setSchoolCode(
                      value.toUpperCase()
                    )
                  }
                  placeholder="DIGI001"
                  disabled={creating}
                />

                <Input
                  label="School Email"
                  type="email"
                  value={schoolEmail}
                  onChange={
                    setSchoolEmail
                  }
                  placeholder="school@example.com"
                  disabled={creating}
                />

                <Input
                  label="School Phone"
                  value={schoolPhone}
                  onChange={
                    setSchoolPhone
                  }
                  placeholder="9876543210"
                  disabled={creating}
                />

                <Input
                  label="Student Limit"
                  type="number"
                  value={studentLimit}
                  onChange={
                    setStudentLimit
                  }
                  placeholder="300"
                  disabled={creating}
                />
              </div>

              {/* OWNER */}

              <div className="mt-8 border-t border-slate-200 pt-7">
                <h3 className="font-bold text-slate-900">
                  School Owner Login
                </h3>

                <p className="mt-1 text-sm text-slate-500">
                  These credentials will be used by the school owner.
                </p>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Owner Name *"
                    value={ownerName}
                    onChange={
                      setOwnerName
                    }
                    placeholder="Dharani"
                    disabled={creating}
                  />

                  <Input
                    label="Owner Email *"
                    type="email"
                    value={ownerEmail}
                    onChange={
                      setOwnerEmail
                    }
                    placeholder="owner@example.com"
                    disabled={creating}
                  />

                  <Input
                    label="Owner Phone"
                    value={ownerPhone}
                    onChange={
                      setOwnerPhone
                    }
                    placeholder="9876543210"
                    disabled={creating}
                  />

                  <Input
                    label="Password *"
                    type="password"
                    value={ownerPassword}
                    onChange={
                      setOwnerPassword
                    }
                    placeholder="Minimum 8 characters"
                    disabled={creating}
                  />
                </div>
              </div>

              {/* ACTIONS */}

              <div className="mt-8 flex justify-end gap-3 border-t border-slate-200 pt-6">
                <button
                  type="button"
                  onClick={
                    closeCreateSchool
                  }
                  disabled={creating}
                  className="rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                >
                  {creating
                    ? "Creating..."
                    : "Create School"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

// =====================================================
// STAT CARD
// =====================================================

function StatCard({
  title,
  value,
}: {
  title: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm text-slate-500">
        {title}
      </p>

      <p className="mt-2 text-3xl font-bold text-slate-900">
        {value}
      </p>
    </div>
  );
}

// =====================================================
// INPUT
// =====================================================

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-slate-700">
        {label}
      </label>

      <input
        type={type}
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value
          )
        }
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
      />
    </div>
  );
}