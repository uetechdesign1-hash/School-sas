"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type FormState = {
  employee_no: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  gender: string;
  date_of_birth: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  joining_date: string;
  department: string;
  designation: string;
  employment_type: string;
  status: string;
  photo_url: string;
};

export default function StaffEditPage() {
  const params = useParams();
  const router = useRouter();

  const staffId = Array.isArray(params.id)
    ? params.id[0]
    : params.id;

  const [form, setForm] = useState<FormState>({
    employee_no: "",
    first_name: "",
    middle_name: "",
    last_name: "",
    gender: "",
    date_of_birth: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    joining_date: "",
    department: "",
    designation: "",
    employment_type: "full_time",
    status: "active",
    photo_url: "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (staffId) {
      void loadStaff();
    }
  }, [staffId]);

  async function loadStaff() {
    try {
      setLoading(true);
      setError("");

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
          "Your account is not assigned to an active school."
        );
      }

      if (
        membership.role !== "owner" &&
        membership.role !== "admin"
      ) {
        throw new Error(
          "Only school owner or admin can edit staff."
        );
      }

      const { data: staff, error: staffError } =
        await supabase
          .from("staff")
          .select(`
            id,
            school_id,
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
          `)
          .eq("id", staffId)
          .eq("school_id", membership.school_id)
          .maybeSingle();

      if (staffError) {
        throw staffError;
      }

      if (!staff) {
        throw new Error("Staff member was not found.");
      }

      setForm({
        employee_no: staff.employee_no || "",
        first_name: staff.first_name || "",
        middle_name: staff.middle_name || "",
        last_name: staff.last_name || "",
        gender: staff.gender || "",
        date_of_birth: staff.date_of_birth || "",
        phone: staff.phone || "",
        email: staff.email || "",
        address: staff.address || "",
        city: staff.city || "",
        joining_date: staff.joining_date || "",
        department: staff.department || "",
        designation: staff.designation || "",
        employment_type: staff.employment_type || "full_time",
        status: staff.status || "active",
        photo_url: staff.photo_url || "",
      });
    } catch (err) {
      console.error("EDIT STAFF LOAD ERROR:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load staff."
      );
    } finally {
      setLoading(false);
    }
  }

  function updateField(
    field: keyof FormState,
    value: string
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function saveChanges() {
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
          "Your account is not assigned to an active school."
        );
      }

      if (
        membership.role !== "owner" &&
        membership.role !== "admin"
      ) {
        throw new Error(
          "Only school owner or admin can edit staff."
        );
      }

      const { data: duplicate, error: duplicateError } =
        await supabase
          .from("staff")
          .select("id")
          .eq("school_id", membership.school_id)
          .eq(
            "employee_no",
            form.employee_no.trim()
          )
          .neq("id", staffId)
          .maybeSingle();

      if (duplicateError) {
        throw duplicateError;
      }

      if (duplicate) {
        throw new Error(
          `Employee number "${form.employee_no.trim()}" is already used by another staff member.`
        );
      }

      const { error: updateError } =
        await supabase
          .from("staff")
          .update({
            employee_no: form.employee_no.trim(),
            first_name: form.first_name.trim(),
            middle_name:
              form.middle_name.trim() || null,
            last_name:
              form.last_name.trim() || null,
            gender: form.gender || null,
            date_of_birth:
              form.date_of_birth || null,
            phone: form.phone.trim() || null,
            email: form.email.trim() || null,
            address:
              form.address.trim() || null,
            city: form.city.trim() || null,
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
            updated_at:
              new Date().toISOString(),
          })
          .eq("id", staffId)
          .eq(
            "school_id",
            membership.school_id
          );

      if (updateError) {
        throw updateError;
      }

      setSuccess(
        "Staff details updated successfully."
      );

      setTimeout(() => {
        router.push(
          `/dashboard/staff/${staffId}`
        );
      }, 700);
    } catch (err) {
      console.error("SAVE STAFF ERROR:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Unable to update staff."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl rounded-2xl border bg-white p-12 text-center shadow-sm">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
          <p className="mt-4 text-sm text-slate-500">
            Loading staff details...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <Link
          href={`/dashboard/staff/${staffId}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Staff Profile
        </Link>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="bg-slate-950 px-6 py-7 text-white">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Staff Management
            </p>

            <h1 className="mt-2 text-2xl font-bold">
              Edit Staff
            </h1>

            <p className="mt-1 text-sm text-slate-300">
              Update staff personal and employment details.
            </p>
          </div>

          {error && (
            <div className="m-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="m-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
              {success}
            </div>
          )}

          <div className="grid gap-5 p-6 md:grid-cols-2">
            <Field
              label="Employee Number"
              required
              value={form.employee_no}
              onChange={(v) =>
                updateField("employee_no", v)
              }
            />

            <Field
              label="Joining Date"
              required
              type="date"
              value={form.joining_date}
              onChange={(v) =>
                updateField("joining_date", v)
              }
            />

            <Field
              label="First Name"
              required
              value={form.first_name}
              onChange={(v) =>
                updateField("first_name", v)
              }
            />

            <Field
              label="Middle Name"
              value={form.middle_name}
              onChange={(v) =>
                updateField("middle_name", v)
              }
            />

            <Field
              label="Last Name"
              value={form.last_name}
              onChange={(v) =>
                updateField("last_name", v)
              }
            />

            <SelectField
              label="Gender"
              value={form.gender}
              onChange={(v) =>
                updateField("gender", v)
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
              onChange={(v) =>
                updateField("date_of_birth", v)
              }
            />

            <Field
              label="Phone"
              type="tel"
              value={form.phone}
              onChange={(v) =>
                updateField("phone", v)
              }
            />

            <Field
              label="Email"
              type="email"
              value={form.email}
              onChange={(v) =>
                updateField("email", v)
              }
            />

            <Field
              label="City"
              value={form.city}
              onChange={(v) =>
                updateField("city", v)
              }
            />

            <Field
              label="Department"
              value={form.department}
              onChange={(v) =>
                updateField("department", v)
              }
            />

            <Field
              label="Designation"
              value={form.designation}
              onChange={(v) =>
                updateField("designation", v)
              }
            />

            <SelectField
              label="Employment Type"
              value={form.employment_type}
              onChange={(v) =>
                updateField(
                  "employment_type",
                  v
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
              onChange={(v) =>
                updateField("status", v)
              }
            >
              <option value="active">Active</option>
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

            <Field
              label="Photo URL"
              value={form.photo_url}
              onChange={(v) =>
                updateField("photo_url", v)
              }
            />

            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-700">
                Address
              </label>

              <textarea
                value={form.address}
                onChange={(e) =>
                  updateField(
                    "address",
                    e.target.value
                  )
                }
                rows={4}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-slate-100 p-6 sm:flex-row sm:justify-end">
            <Link
              href={`/dashboard/staff/${staffId}`}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>

            <button
              type="button"
              onClick={() => void saveChanges()}
              disabled={saving}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving
                ? "Saving..."
                : "Save Changes"}
            </button>
          </div>
        </div>
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
}: {
  label: string;
  required?: boolean;
  type?: string;
  value: string;
  onChange: (value: string) => void;
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
        required={required}
        onChange={(e) =>
          onChange(e.target.value)
        }
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
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700">
        {label}
      </label>

      <select
        value={value}
        onChange={(e) =>
          onChange(e.target.value)
        }
        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
      >
        {children}
      </select>
    </div>
  );
}
