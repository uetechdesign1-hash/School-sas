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
  created_at: string;
};

type FormData = {
  schoolName: string;
  schoolCode: string;
  schoolEmail: string;
  schoolPhone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  planCode: string;
  studentLimit: string;
  startsOn: string;
  expiresOn: string;

  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  ownerPassword: string;
};

const emptyForm: FormData = {
  schoolName: "",
  schoolCode: "",
  schoolEmail: "",
  schoolPhone: "",
  address: "",
  city: "",
  state: "",
  postalCode: "",
  planCode: "starter",
  studentLimit: "300",
  startsOn: new Date().toISOString().slice(0, 10),
  expiresOn: "",

  ownerName: "",
  ownerEmail: "",
  ownerPhone: "",
  ownerPassword: "",
};

export default function SuperAdminPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");

  const [schools, setSchools] = useState<School[]>(
    []
  );

  const [showCreateModal, setShowCreateModal] =
    useState(false);

  const [form, setForm] =
    useState<FormData>(emptyForm);

  const [errorMessage, setErrorMessage] =
    useState("");

  const [successMessage, setSuccessMessage] =
    useState("");

  // --------------------------------------------------
  // LOAD ADMIN
  // --------------------------------------------------

  useEffect(() => {
    let mounted = true;

    async function loadAdmin() {
      try {
        const {
          data: {
            user,
          },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
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

        if (!mounted) return;

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

        if (mounted) {
          router.replace(
            "/super-admin/login"
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadAdmin();

    return () => {
      mounted = false;
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
        "id, name, code, school_code, status, plan_code, student_limit, expires_on, created_at"
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      );

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
  // OPEN CREATE SCHOOL
  // --------------------------------------------------

  function openCreateSchool() {
    setErrorMessage("");
    setSuccessMessage("");

    setForm({
      ...emptyForm,
      startsOn:
        new Date()
          .toISOString()
          .slice(0, 10),
    });

    setShowCreateModal(true);
  }

  // --------------------------------------------------
  // CLOSE CREATE SCHOOL
  // --------------------------------------------------

  function closeCreateSchool() {
    if (creating) return;

    setShowCreateModal(false);
    setErrorMessage("");
  }

  // --------------------------------------------------
  // FORM CHANGE
  // --------------------------------------------------

  function updateField(
    field: keyof FormData,
    value: string
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
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

    if (!form.schoolName.trim()) {
      setErrorMessage(
        "Please enter the school name."
      );
      return;
    }

    if (!form.schoolCode.trim()) {
      setErrorMessage(
        "Please enter the school code."
      );
      return;
    }

    if (!form.ownerName.trim()) {
      setErrorMessage(
        "Please enter the owner name."
      );
      return;
    }

    if (!form.ownerEmail.trim()) {
      setErrorMessage(
        "Please enter the owner email."
      );
      return;
    }

    if (
      form.ownerPassword.length < 8
    ) {
      setErrorMessage(
        "Owner password must contain at least 8 characters."
      );
      return;
    }

    setCreating(true);

    try {
      /*
       * The logged-in Supabase session is automatically
       * attached by supabase.functions.invoke().
       */

      const {
        data,
        error,
      } =
        await supabase.functions.invoke(
          "create-school",
          {
            body: {
              school_name:
                form.schoolName.trim(),

              school_code:
                form.schoolCode
                  .trim()
                  .toUpperCase(),

              email:
                form.schoolEmail.trim() ||
                null,

              phone:
                form.schoolPhone.trim() ||
                null,

              address:
                form.address.trim() ||
                null,

              city:
                form.city.trim() ||
                null,

              state:
                form.state.trim() ||
                null,

              postal_code:
                form.postalCode.trim() ||
                null,

              plan_code:
                form.planCode,

              student_limit:
                Number(
                  form.studentLimit || 300
                ),

              starts_on:
                form.startsOn || null,

              expires_on:
                form.expiresOn || null,

              owner_name:
                form.ownerName.trim(),

              owner_email:
                form.ownerEmail
                  .trim()
                  .toLowerCase(),

              owner_phone:
                form.ownerPhone.trim() ||
                null,

              owner_password:
                form.ownerPassword,
            },
          }
        );

      if (error) {
        console.error(
          "CREATE SCHOOL FUNCTION ERROR:",
          error
        );

        let message =
          error.message ||
          "Unable to create school.";

        /*
         * Supabase Edge Functions sometimes
         * return the actual JSON error in
         * error.context.
         */

        try {
          if (
            error.context &&
            typeof error.context.json ===
              "function"
          ) {
            const body =
              await error.context.json();

            if (body?.error) {
              message = body.error;
            }
          }
        } catch {
          // Keep original error message.
        }

        setErrorMessage(message);
        return;
      }

      if (!data?.success) {
        setErrorMessage(
          data?.error ||
            "School creation failed."
        );
        return;
      }

      setSuccessMessage(
        "School and owner created successfully."
      );

      setShowCreateModal(false);

      setForm(emptyForm);

      await loadSchools();
    } catch (error) {
      console.error(
        "CREATE SCHOOL ERROR:",
        error
      );

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to create school."
      );
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
    } finally {
      router.replace(
        "/super-admin/login"
      );
      router.refresh();
    }
  }

  // --------------------------------------------------
  // STATS
  // --------------------------------------------------

  const totalSchools =
    schools.length;

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

  const today =
    new Date();

  const expiringSoon =
    schools.filter((school) => {
      if (!school.expires_on) {
        return false;
      }

      const expiry =
        new Date(
          school.expires_on
        );

      const diff =
        expiry.getTime() -
        today.getTime();

      const days =
        diff /
        (1000 * 60 * 60 * 24);

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
      <main className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="rounded-2xl bg-white px-8 py-6 shadow">
          <p className="text-sm text-slate-600">
            Loading Super Admin...
          </p>
        </div>
      </main>
    );
  }

  // --------------------------------------------------
  // PAGE
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
            className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
            value={totalSchools}
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

            {/* THIS BUTTON NOW OPENS THE MODAL */}

            <button
              type="button"
              onClick={openCreateSchool}
              className="mt-6 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 active:scale-[0.99]"
            >
              + Create School
            </button>
          </div>

          {/* ADMIN ACCOUNT */}

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">
              Admin Account
            </h2>

            <div className="mt-5 rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Email
              </p>

              <p className="mt-1 text-sm font-medium text-slate-900">
                {userEmail}
              </p>

              <p className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-400">
                Role
              </p>

              <p className="mt-1 text-sm font-medium text-blue-600">
                Super Administrator
              </p>
            </div>
          </div>
        </section>

        {/* SCHOOLS */}

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
              onClick={loadSchools}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>

          {schools.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-10 text-center">
              <p className="font-medium text-slate-700">
                No schools yet
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
                    <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-400">
                      School
                    </th>

                    <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-400">
                      Code
                    </th>

                    <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-400">
                      Plan
                    </th>

                    <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-400">
                      Students
                    </th>

                    <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-400">
                      Status
                    </th>

                    <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-400">
                      Expiry
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {schools.map(
                    (school) => (
                      <tr
                        key={school.id}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="px-4 py-4">
                          <p className="font-semibold text-slate-900">
                            {school.name}
                          </p>
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
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                              school.status ===
                              "active"
                                ? "bg-green-100 text-green-700"
                                : school.status ===
                                  "trial"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {school.status}
                          </span>
                        </td>

                        <td className="px-4 py-4 text-sm text-slate-600">
                          {school.expires_on
                            ? new Date(
                                school.expires_on
                              ).toLocaleDateString()
                            : "-"}
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

      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeCreateSchool();
            }
          }}
        >
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            {/* MODAL HEADER */}

            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  Create School
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Create the school and its owner login.
                </p>
              </div>

              <button
                type="button"
                onClick={closeCreateSchool}
                disabled={creating}
                className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={handleCreateSchool}
              className="p-6"
            >
              {/* ERROR */}

              {errorMessage && (
                <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-sm font-medium text-red-700">
                    {errorMessage}
                  </p>
                </div>
              )}

              {/* SCHOOL INFORMATION */}

              <div>
                <h3 className="text-base font-bold text-slate-900">
                  School Information
                </h3>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Input
                    label="School Name *"
                    value={form.schoolName}
                    onChange={(value) =>
                      updateField(
                        "schoolName",
                        value
                      )
                    }
                    placeholder="ABC Public School"
                    disabled={creating}
                  />

                  <Input
                    label="School Code *"
                    value={form.schoolCode}
                    onChange={(value) =>
                      updateField(
                        "schoolCode",
                        value.toUpperCase()
                      )
                    }
                    placeholder="ABC001"
                    disabled={creating}
                  />

                  <Input
                    label="School Email"
                    type="email"
                    value={form.schoolEmail}
                    onChange={(value) =>
                      updateField(
                        "schoolEmail",
                        value
                      )
                    }
                    placeholder="school@example.com"
                    disabled={creating}
                  />

                  <Input
                    label="School Phone"
                    value={form.schoolPhone}
                    onChange={(value) =>
                      updateField(
                        "schoolPhone",
                        value
                      )
                    }
                    placeholder="9876543210"
                    disabled={creating}
                  />

                  <div className="sm:col-span-2">
                    <Input
                      label="Address"
                      value={form.address}
                      onChange={(value) =>
                        updateField(
                          "address",
                          value
                        )
                      }
                      placeholder="School address"
                      disabled={creating}
                    />
                  </div>

                  <Input
                    label="City"
                    value={form.city}
                    onChange={(value) =>
                      updateField(
                        "city",
                        value
                      )
                    }
                    placeholder="Hyderabad"
                    disabled={creating}
                  />

                  <Input
                    label="State"
                    value={form.state}
                    onChange={(value) =>
                      updateField(
                        "state",
                        value
                      )
                    }
                    placeholder="Telangana"
                    disabled={creating}
                  />

                  <Input
                    label="Postal Code"
                    value={form.postalCode}
                    onChange={(value) =>
                      updateField(
                        "postalCode",
                        value
                      )
                    }
                    placeholder="500001"
                    disabled={creating}
                  />
                </div>
              </div>

              {/* PLAN */}

              <div className="mt-8 border-t border-slate-200 pt-7">
                <h3 className="text-base font-bold text-slate-900">
                  Subscription
                </h3>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Select
                    label="Plan"
                    value={form.planCode}
                    onChange={(value) =>
                      updateField(
                        "planCode",
                        value
                      )
                    }
                    disabled={creating}
                    options={[
                      {
                        value: "starter",
                        label: "Starter",
                      },
                      {
                        value: "professional",
                        label: "Professional",
                      },
                      {
                        value: "enterprise",
                        label: "Enterprise",
                      },
                    ]}
                  />

                  <Input
                    label="Student Limit"
                    type="number"
                    value={form.studentLimit}
                    onChange={(value) =>
                      updateField(
                        "studentLimit",
                        value
                      )
                    }
                    placeholder="300"
                    disabled={creating}
                  />

                  <Input
                    label="Starts On"
                    type="date"
                    value={form.startsOn}
                    onChange={(value) =>
                      updateField(
                        "startsOn",
                        value
                      )
                    }
                    disabled={creating}
                  />

                  <Input
                    label="Expires On"
                    type="date"
                    value={form.expiresOn}
                    onChange={(value) =>
                      updateField(
                        "expiresOn",
                        value
                      )
                    }
                    disabled={creating}
                  />
                </div>
              </div>

              {/* OWNER */}

              <div className="mt-8 border-t border-slate-200 pt-7">
                <h3 className="text-base font-bold text-slate-900">
                  School Owner Login
                </h3>

                <p className="mt-1 text-sm text-slate-500">
                  These credentials will be used by the school owner to log in.
                </p>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Owner Name *"
                    value={form.ownerName}
                    onChange={(value) =>
                      updateField(
                        "ownerName",
                        value
                      )
                    }
                    placeholder="School Owner"
                    disabled={creating}
                  />

                  <Input
                    label="Owner Email *"
                    type="email"
                    value={form.ownerEmail}
                    onChange={(value) =>
                      updateField(
                        "ownerEmail",
                        value
                      )
                    }
                    placeholder="owner@example.com"
                    disabled={creating}
                  />

                  <Input
                    label="Owner Phone"
                    value={form.ownerPhone}
                    onChange={(value) =>
                      updateField(
                        "ownerPhone",
                        value
                      )
                    }
                    placeholder="9876543210"
                    disabled={creating}
                  />

                  <Input
                    label="Temporary Password *"
                    type="password"
                    value={form.ownerPassword}
                    onChange={(value) =>
                      updateField(
                        "ownerPassword",
                        value
                      )
                    }
                    placeholder="Minimum 8 characters"
                    disabled={creating}
                  />
                </div>
              </div>

              {/* ACTIONS */}

              <div className="mt-8 flex flex-col-reverse gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeCreateSchool}
                  disabled={creating}
                  className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                >
                  {creating
                    ? "Creating School..."
                    : "Create School + Owner"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

// --------------------------------------------------
// STAT CARD
// --------------------------------------------------

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

// --------------------------------------------------
// INPUT
// --------------------------------------------------

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
          onChange(event.target.value)
        }
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
      />
    </div>
  );
}

// --------------------------------------------------
// SELECT
// --------------------------------------------------

function Select({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: {
    value: string;
    label: string;
  }[];
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-slate-700">
        {label}
      </label>

      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        disabled={disabled}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
      >
        {options.map(
          (option) => (
            <option
              key={option.value}
              value={option.value}
            >
              {option.label}
            </option>
          )
        )}
      </select>
    </div>
  );
}