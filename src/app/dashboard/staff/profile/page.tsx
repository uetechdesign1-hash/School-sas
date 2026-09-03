"use client";

import { useEffect, useMemo, useState } from "react";
import {
  UserRound,
  Phone,
  Mail,
  BriefcaseBusiness,
  CalendarDays,
  MapPin,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Staff = {
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
};

function value(text: string | null) {
  return text || "Not provided";
}

function fullName(staff: Staff) {
  return [
    staff.first_name,
    staff.middle_name,
    staff.last_name,
  ]
    .filter(Boolean)
    .join(" ");
}

function date(value: string | null) {
  if (!value) return "Not provided";

  return new Date(
    `${value}T00:00:00`
  ).toLocaleDateString(
    "en-IN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  );
}

function Info({
  icon: Icon,
  label,
  value: text,
}: {
  icon: any;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3">

      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0">

        <p className="text-xs text-slate-400">
          {label}
        </p>

        <p className="mt-1 break-words text-sm font-semibold text-slate-800">
          {value}
        </p>

      </div>

    </div>
  );
}

export default function StaffProfilePage() {
  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [staff, setStaff] =
    useState<Staff | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    async function load() {
      try {
        const {
          data: {
            user,
          },
        } =
          await supabase.auth.getUser();

        if (!user) {
          window.location.href = "/login";
          return;
        }

        const {
          data,
          error: staffError,
        } =
          await supabase
            .from("staff")
            .select(
              `
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
                status
              `
            )
            .eq(
              "user_id",
              user.id
            )
            .maybeSingle();

        if (staffError) {
          throw staffError;
        }

        if (!data) {
          throw new Error(
            "Your login is not linked to a staff member."
          );
        }

        setStaff(data);
      } catch (err: any) {
        console.error(
          "STAFF PROFILE ERROR:",
          err
        );

        setError(
          err?.message ||
            "Unable to load your profile."
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [supabase]);

  if (loading) {
    return (
      <div className="p-6">
        Loading profile...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!staff) {
    return null;
  }

  const name = fullName(staff);

  return (
    <div className="p-4 sm:p-6 lg:p-8">

      <div className="mx-auto max-w-5xl">

        {/* HEADER */}

        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">

            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-blue-50 text-2xl font-bold text-blue-600">
              {name
                .split(" ")
                .map(
                  (part) =>
                    part[0]
                )
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>

            <div>

              <p className="text-sm text-slate-500">
                My Profile
              </p>

              <h1 className="mt-1 text-2xl font-bold text-slate-900">
                {name ||
                  "Staff Member"}
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                {value(
                  staff.designation
                )}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">

                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold capitalize text-emerald-700">
                  {value(
                    staff.status
                  )}
                </span>

                {staff.employee_no && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    {staff.employee_no}
                  </span>
                )}

              </div>

            </div>

          </div>

        </div>

        {/* PERSONAL */}

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 p-5">

            <div className="flex items-center gap-3">

              <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
                <UserRound className="h-5 w-5" />
              </div>

              <div>
                <h2 className="font-bold text-slate-900">
                  Personal Information
                </h2>

                <p className="text-sm text-slate-500">
                  Your personal details
                </p>
              </div>

            </div>

          </div>

          <div className="grid gap-6 p-5 sm:grid-cols-2">

            <Info
              icon={UserRound}
              label="Full Name"
              value={name}
            />

            <Info
              icon={UserRound}
              label="Gender"
              value={value(
                staff.gender
              )}
            />

            <Info
              icon={CalendarDays}
              label="Date of Birth"
              value={date(
                staff.date_of_birth
              )}
            />

            <Info
              icon={Phone}
              label="Phone"
              value={value(
                staff.phone
              )}
            />

            <Info
              icon={Mail}
              label="Email"
              value={value(
                staff.email
              )}
            />

            <Info
              icon={MapPin}
              label="City"
              value={value(
                staff.city
              )}
            />

            <div className="sm:col-span-2">

              <Info
                icon={MapPin}
                label="Address"
                value={value(
                  staff.address
                )}
              />

            </div>

          </div>

        </section>

        {/* EMPLOYMENT */}

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 p-5">

            <div className="flex items-center gap-3">

              <div className="rounded-xl bg-violet-50 p-3 text-violet-600">
                <BriefcaseBusiness className="h-5 w-5" />
              </div>

              <div>
                <h2 className="font-bold text-slate-900">
                  Employment Information
                </h2>

                <p className="text-sm text-slate-500">
                  Your school employment details
                </p>
              </div>

            </div>

          </div>

          <div className="grid gap-6 p-5 sm:grid-cols-2">

            <Info
              icon={BriefcaseBusiness}
              label="Employee Number"
              value={value(
                staff.employee_no
              )}
            />

            <Info
              icon={BriefcaseBusiness}
              label="Designation"
              value={value(
                staff.designation
              )}
            />

            <Info
              icon={BriefcaseBusiness}
              label="Department"
              value={value(
                staff.department
              )}
            />

            <Info
              icon={BriefcaseBusiness}
              label="Employment Type"
              value={value(
                staff.employment_type
              )}
            />

            <Info
              icon={CalendarDays}
              label="Joining Date"
              value={date(
                staff.joining_date
              )}
            />

            <Info
              icon={UserRound}
              label="Status"
              value={value(
                staff.status
              )}
            />

          </div>

        </section>

      </div>

    </div>
  );
}