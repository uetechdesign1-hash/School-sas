"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type EmploymentType =
  | "full_time"
  | "part_time"
  | "contract"
  | "temporary";

type Gender = "male" | "female" | "other";

export default function NewStaffPage() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState({
    employee_no: "",
    first_name: "",
    middle_name: "",
    last_name: "",
    gender: "" as "" | Gender,
    date_of_birth: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    joining_date: new Date().toISOString().slice(0, 10),
    department: "",
    designation: "",
    employment_type: "full_time" as EmploymentType,
    status: "active",
    photo_url: "",
  });

  function updateField(
    field: keyof typeof form,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      if (!form.employee_no.trim()) {
        throw new Error("Employee number is required.");
      }

      if (!form.first_name.trim()) {
        throw new Error("First name is required.");
      }

      if (!form.joining_date) {
        throw new Error("Joining date is required.");
      }

      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.assign("/login");
        return;
      }

      const { data: membership, error: membershipError } =
        await supabase
          .from("school_users")
          .select("school_id, role, is_active")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

      if (membershipError) {
        throw membershipError;
      }

      if (!membership?.school_id) {
        throw new Error(
          "Your account is not assigned to an active school.",
        );
      }

      const { data: existingStaff, error: existingError } =
        await supabase
          .from("staff")
          .select("id")
          .eq("school_id", membership.school_id)
          .eq(
            "employee_no",
            form.employee_no.trim(),
          )
          .maybeSingle();

      if (existingError) {
        throw existingError;
      }

      if (existingStaff) {
        throw new Error(
          `Employee number "${form.employee_no.trim()}" already exists in this school.`,
        );
      }

      const { data, error: insertError } =
        await supabase
          .from("staff")
          .insert({
            school_id: membership.school_id,

            employee_no: form.employee_no.trim(),

            first_name: form.first_name.trim(),

            middle_name:
              form.middle_name.trim() || null,

            last_name:
              form.last_name.trim() || null,

            gender: form.gender || null,

            date_of_birth:
              form.date_of_birth || null,

            phone:
              form.phone.trim() || null,

            email:
              form.email.trim() || null,

            address:
              form.address.trim() || null,

            city:
              form.city.trim() || null,

            joining_date: form.joining_date,

            department:
              form.department.trim() || null,

            designation:
              form.designation.trim() || null,

            employment_type:
              form.employment_type,

            status: form.status,

            photo_url:
              form.photo_url.trim() || null,
          })
          .select("id")
          .single();

      if (insertError) {
        throw insertError;
      }

      setSuccess(
        "Staff member created successfully.",
      );

      if (data?.id) {
        window.setTimeout(() => {
          window.location.assign(
            `/dashboard/staff/${data.id}`,
          );
        }, 700);
      }
    } catch (err) {
      console.error("CREATE STAFF ERROR:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Unable to create staff member.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-full bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href="/dashboard/staff"
              className="inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              ← Back to Staff
            </Link>

            <p className="mt-4 text-sm text-slate-500">
              School Management
            </p>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              Add Staff
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Add a teacher, driver, office employee or
              other staff member.
            </p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="font-semibold text-red-800">
              Unable to create staff member
            </p>

            <p className="mt-1 text-sm text-red-700">
              {error}
            </p>
          </div>
        )}

        {/* Success */}
        {success && (
          <div className="mb-6 rounded-2xl border border-green-200 bg-green-50 p-5">
            <p className="font-semibold text-green-800">
              {success}
            </p>

            <p className="mt-1 text-sm text-green-700">
              Opening the staff profile...
            </p>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="space-y-6"
        >
          {/* Personal Information */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="mb-5">
              <h2 className="text-lg font-bold text-slate-900">
                Personal Information
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Basic information about the staff member.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <Field
                label="First Name"
                required
                value={form.first_name}
                onChange={(value) =>
                  updateField("first_name", value)
                }
                placeholder="Enter first name"
              />

              <Field
                label="Middle Name"
                value={form.middle_name}
                onChange={(value) =>
                  updateField("middle_name", value)
                }
                placeholder="Enter middle name"
              />

              <Field
                label="Last Name"
                value={form.last_name}
                onChange={(value) =>
                  updateField("last_name", value)
                }
                placeholder="Enter last name"
              />

              <SelectField
                label="Gender"
                value={form.gender}
                onChange={(value) =>
                  updateField("gender", value)
                }
              >
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </SelectField>

              <Field
                label="Date of Birth"
                type="date"
                value={form.date_of_birth}
                onChange={(value) =>
                  updateField(
                    "date_of_birth",
                    value,
                  )
                }
              />

              <Field
                label="City"
                value={form.city}
                onChange={(value) =>
                  updateField("city", value)
                }
                placeholder="Enter city"
              />
            </div>
          </section>

          {/* Employment */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="mb-5">
              <h2 className="text-lg font-bold text-slate-900">
                Employment Information
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Information used to identify and manage
                the employee.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <Field
                label="Employee Number"
                required
                value={form.employee_no}
                onChange={(value) =>
                  updateField(
                    "employee_no",
                    value,
                  )
                }
                placeholder="Example: STF-001"
              />

              <Field
                label="Joining Date"
                required
                type="date"
                value={form.joining_date}
                onChange={(value) =>
                  updateField(
                    "joining_date",
                    value,
                  )
                }
              />

              <Field
                label="Department"
                value={form.department}
                onChange={(value) =>
                  updateField(
                    "department",
                    value,
                  )
                }
                placeholder="Example: Mathematics"
              />

              <Field
                label="Designation"
                value={form.designation}
                onChange={(value) =>
                  updateField(
                    "designation",
                    value,
                  )
                }
                placeholder="Example: Teacher"
              />

              <SelectField
                label="Employment Type"
                value={form.employment_type}
                onChange={(value) =>
                  updateField(
                    "employment_type",
                    value,
                  )
                }
              >
                <option value="full_time">
                  Full Time
                </option>
                <option value="part_time">
                  Part Time
                </option>
                <option value="contract">
                  Contract
                </option>
                <option value="temporary">
                  Temporary
                </option>
              </SelectField>

              <SelectField
                label="Status"
                value={form.status}
                onChange={(value) =>
                  updateField("status", value)
                }
              >
                <option value="active">
                  Active
                </option>
                <option value="inactive">
                  Inactive
                </option>
                <option value="resigned">
                  Resigned
                </option>
                <option value="terminated">
                  Terminated
                </option>
                <option value="retired">
                  Retired
                </option>
              </SelectField>
            </div>
          </section>

          {/* Contact */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="mb-5">
              <h2 className="text-lg font-bold text-slate-900">
                Contact Information
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Contact details for the staff member.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <Field
                label="Phone"
                type="tel"
                value={form.phone}
                onChange={(value) =>
                  updateField("phone", value)
                }
                placeholder="Enter phone number"
              />

              <Field
                label="Email"
                type="email"
                value={form.email}
                onChange={(value) =>
                  updateField("email", value)
                }
                placeholder="Enter email address"
              />

              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-slate-700">
                  Address
                </label>

                <textarea
                  value={form.address}
                  onChange={(event) =>
                    updateField(
                      "address",
                      event.target.value,
                    )
                  }
                  rows={3}
                  placeholder="Enter full address"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </div>

              <Field
                label="Photo URL"
                value={form.photo_url}
                onChange={(value) =>
                  updateField(
                    "photo_url",
                    value,
                  )
                }
                placeholder="Optional photo URL"
              />
            </div>
          </section>

          {/* Footer */}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Link
              href="/dashboard/staff"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving
                ? "Saving..."
                : "Save Staff Member"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  required = false,
  type = "text",
  value,
  onChange,
  placeholder,
}: {
  label: string;
  required?: boolean;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700">
        {label}

        {required && (
          <span className="ml-1 text-red-500">
            *
          </span>
        )}
      </label>

      <input
        type={type}
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        placeholder={placeholder}
        required={required}
        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700">
        {label}
      </label>

      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
      >
        {children}
      </select>
    </div>
  );
}