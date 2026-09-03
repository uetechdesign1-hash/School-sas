"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  Filter,
  Mail,
  MapPin,
  Navigation,
  Phone,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  UserCheck,
  UserRound,
  Users,
  UserX,
  X,
  BarChart3,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Staff = {
  id: string;
  school_id: string;
  employee_no: string;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  gender: string | null;
  date_of_birth: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  joining_date: string;
  department: string | null;
  designation: string | null;
  employment_type: string;
  status: string;
  photo_url: string | null;
  user_id: string | null;
};

type SchoolMembership = {
  school_id: string;
  role: string;
  is_active: boolean;
};

function staffName(staff: Staff) {
  return [
    staff.first_name,
    staff.middle_name,
    staff.last_name,
  ]
    .filter(Boolean)
    .join(" ");
}

function initials(staff: Staff) {
  const first =
    staff.first_name?.charAt(0) || "";

  const last =
    staff.last_name?.charAt(0) || "";

  return (
    `${first}${last}`.toUpperCase() ||
    "ST"
  );
}

function label(
  value: string | null | undefined
) {
  if (!value) return "Not set";

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    );
}

function statusClass(status: string) {
  switch (status.toLowerCase()) {
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";

    case "inactive":
      return "border-amber-200 bg-amber-50 text-amber-700";

    case "resigned":
      return "border-orange-200 bg-orange-50 text-orange-700";

    case "terminated":
      return "border-red-200 bg-red-50 text-red-700";

    case "retired":
      return "border-slate-200 bg-slate-100 text-slate-700";

    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

export default function StaffPage() {
  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [staff, setStaff] =
    useState<Staff[]>([]);

  const [membership, setMembership] =
    useState<SchoolMembership | null>(
      null
    );

  const [schoolName, setSchoolName] =
    useState("School");

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [search, setSearch] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState("all");

  const [departmentFilter, setDepartmentFilter] =
    useState("all");

  const [showFilters, setShowFilters] =
    useState(false);

  useEffect(() => {
    void loadStaff();
  }, []);

  async function loadStaff() {
    try {
      setLoading(true);
      setError("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.assign("/login");
        return;
      }

      const {
        data: membershipData,
        error: membershipError,
      } = await supabase
        .from("school_users")
        .select(
          "school_id, role, is_active"
        )
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (membershipError) {
        throw membershipError;
      }

      if (!membershipData?.school_id) {
        throw new Error(
          "Your account is not assigned to an active school."
        );
      }

      setMembership(
        membershipData as SchoolMembership
      );

      const {
        data: schoolData,
        error: schoolError,
      } = await supabase
        .from("schools")
        .select("id, name")
        .eq(
          "id",
          membershipData.school_id
        )
        .maybeSingle();

      if (schoolError) {
        throw schoolError;
      }

      setSchoolName(
        schoolData?.name || "School"
      );

      const {
        data: staffData,
        error: staffError,
      } = await supabase
        .from("staff")
        .select(
          `
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
            photo_url,
            user_id
          `
        )
        .eq(
          "school_id",
          membershipData.school_id
        )
        .order("first_name", {
          ascending: true,
        });

      if (staffError) {
        throw staffError;
      }

      setStaff(
        (staffData || []) as Staff[]
      );
    } catch (err) {
      console.error(
        "STAFF DIRECTORY ERROR:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load staff."
      );
    } finally {
      setLoading(false);
    }
  }

  const departments = useMemo(() => {
    return Array.from(
      new Set(
        staff
          .map(
            (item) => item.department
          )
          .filter(
            (
              value
            ): value is string =>
              Boolean(value)
          )
      )
    ).sort();
  }, [staff]);

  const stats = useMemo(() => {
    return {
      total: staff.length,

      active: staff.filter(
        (item) =>
          item.status.toLowerCase() ===
          "active"
      ).length,

      inactive: staff.filter(
        (item) =>
          item.status.toLowerCase() ===
          "inactive"
      ).length,

      assigned: staff.filter(
        (item) =>
          Boolean(item.user_id)
      ).length,
    };
  }, [staff]);

  const filteredStaff = useMemo(() => {
    const query =
      search.trim().toLowerCase();

    return staff.filter((item) => {
      const fullName =
        staffName(item).toLowerCase();

      const matchesSearch =
        !query ||
        fullName.includes(query) ||
        item.employee_no
          .toLowerCase()
          .includes(query) ||
        (item.phone || "")
          .toLowerCase()
          .includes(query) ||
        (item.email || "")
          .toLowerCase()
          .includes(query) ||
        (item.designation || "")
          .toLowerCase()
          .includes(query);

      const matchesStatus =
        statusFilter === "all" ||
        item.status.toLowerCase() ===
          statusFilter.toLowerCase();

      const matchesDepartment =
        departmentFilter === "all" ||
        item.department ===
          departmentFilter;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesDepartment
      );
    });
  }, [
    staff,
    search,
    statusFilter,
    departmentFilter,
  ]);

  const hasFilters =
    search.trim() !== "" ||
    statusFilter !== "all" ||
    departmentFilter !== "all";

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setDepartmentFilter("all");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 md:p-8">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center shadow-sm">
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />

            <p className="mt-4 text-sm font-semibold text-slate-600">
              Loading Staff...
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl">

        {/* HEADER */}

        <header className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">

          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-blue-600">
              <Users size={15} />
              Staff Management
            </div>

            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">
              Staff
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              {schoolName}
            </p>

            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Manage employees, attendance,
              salary, login accounts and
              payroll from one place.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">

            <Link
              href="/dashboard/staff/attendance"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
            >
              <Activity size={17} />
              Daily Attendance
            </Link>

            <Link
              href="/dashboard/staff/add"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
            >
              <Plus size={17} />
              Add Staff
            </Link>

          </div>

        </header>

        {/* ERROR */}

        {error && (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">

            <UserX
              size={18}
              className="mt-0.5 shrink-0"
            />

            <div>
              <p className="font-bold">
                Unable to load Staff
              </p>

              <p className="mt-1">
                {error}
              </p>
            </div>

          </div>
        )}

        {/* STATS */}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

          <StatCard
            title="Total Staff"
            value={stats.total}
            description="All employees"
            icon={
              <Users size={20} />
            }
          />

          <StatCard
            title="Active"
            value={stats.active}
            description="Currently working"
            icon={
              <UserCheck size={20} />
            }
          />

          <StatCard
            title="Inactive"
            value={stats.inactive}
            description="Not currently active"
            icon={
              <UserX size={20} />
            }
          />

          <StatCard
            title="Login Assigned"
            value={stats.assigned}
            description="Ready for staff access"
            icon={
              <ShieldCheck size={20} />
            }
          />

        </section>

        {/* =====================================================
            FOUR WORKING CARDS
           ===================================================== */}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

          <ManagementCard
            href="/dashboard/staff/attendance"
            icon={
              <Activity size={21} />
            }
            title="Daily Attendance"
            description="Check-in, check-out and working hours"
          />

          <ManagementCard
            href="/dashboard/payroll"
            icon={
              <BriefcaseBusiness size={21} />
            }
            title="Payroll"
            description="Monthly payroll processing"
          />

          <ManagementCard
            href="/dashboard/staff/reports"
            icon={
              <BarChart3 size={21} />
            }
            title="Attendance Reports"
            description="View staff attendance and GPS records"
          />

          <ManagementCard
            href="/dashboard/staff/settings"
            icon={
              <Settings size={21} />
            }
            title="Attendance Settings"
            description="GPS, geofence and working rules"
          />

        </section>

        {/* DIRECTORY */}

        <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 p-5 md:p-6">

            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

              <div>
                <h2 className="text-lg font-black text-slate-900">
                  Staff Directory
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  {filteredStaff.length} of{" "}
                  {staff.length} staff members
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">

                <div className="relative min-w-0 sm:w-80">

                  <Search
                    size={17}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />

                  <input
                    value={search}
                    onChange={(event) =>
                      setSearch(
                        event.target.value
                      )
                    }
                    placeholder="Search name, employee no..."
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-10 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                  />

                  {search && (
                    <button
                      type="button"
                      onClick={() =>
                        setSearch("")
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                      <X size={16} />
                    </button>
                  )}

                </div>

                <button
                  type="button"
                  onClick={() =>
                    setShowFilters(
                      (value) => !value
                    )
                  }
                  className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-bold transition ${
                    showFilters ||
                    hasFilters
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Filter size={17} />

                  Filters

                  {hasFilters && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] text-white">
                      !
                    </span>
                  )}
                </button>

              </div>

            </div>

            {showFilters && (
              <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-3">

                <FilterSelect
                  label="Status"
                  value={statusFilter}
                  onChange={
                    setStatusFilter
                  }
                  options={[
                    ["all", "All Status"],
                    ["active", "Active"],
                    ["inactive", "Inactive"],
                    ["resigned", "Resigned"],
                    [
                      "terminated",
                      "Terminated",
                    ],
                    ["retired", "Retired"],
                  ]}
                />

                <FilterSelect
                  label="Department"
                  value={
                    departmentFilter
                  }
                  onChange={
                    setDepartmentFilter
                  }
                  options={[
                    [
                      "all",
                      "All Departments",
                    ],
                    ...departments.map(
                      (department) =>
                        [
                          department,
                          department,
                        ] as [
                          string,
                          string
                        ]
                    ),
                  ]}
                />

                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={
                      clearFilters
                    }
                    disabled={
                      !hasFilters
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Clear Filters
                  </button>
                </div>

              </div>
            )}

          </div>

          {/* EMPTY */}

          {filteredStaff.length ===
          0 ? (
            <div className="p-12 text-center md:p-16">

              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                {hasFilters ? (
                  <Search size={24} />
                ) : (
                  <Users size={24} />
                )}
              </div>

              <h3 className="mt-4 font-bold text-slate-900">
                {hasFilters
                  ? "No staff found"
                  : "No staff members yet"}
              </h3>

              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                {hasFilters
                  ? "Try changing your search or filters."
                  : "Add your first staff member to start managing employees."}
              </p>

              {hasFilters ? (
                <button
                  type="button"
                  onClick={
                    clearFilters
                  }
                  className="mt-5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Clear Filters
                </button>
              ) : (
                <Link
                  href="/dashboard/staff/add"
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
                >
                  <Plus size={17} />
                  Add Staff
                </Link>
              )}

            </div>
          ) : (
            <>
              {/* DESKTOP */}

              <div className="hidden overflow-x-auto lg:block">

                <table className="w-full min-w-[950px]">

                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-left">

                      <th className="px-6 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Staff
                      </th>

                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Employee No.
                      </th>

                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Department
                      </th>

                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Designation
                      </th>

                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Employment
                      </th>

                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Status
                      </th>

                      <th className="px-6 py-3 text-right text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Action
                      </th>

                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">

                    {filteredStaff.map(
                      (item) => (
                        <tr
                          key={item.id}
                          className="group transition hover:bg-slate-50/70"
                        >

                          <td className="px-6 py-4">

                            <Link
                              href={`/dashboard/staff/${item.id}`}
                              className="flex items-center gap-3"
                            >

                              <Avatar
                                staff={item}
                              />

                              <div className="min-w-0">

                                <p className="truncate font-bold text-slate-900 group-hover:text-blue-600">
                                  {staffName(
                                    item
                                  )}
                                </p>

                                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">

                                  {item.email && (
                                    <span className="flex items-center gap-1">
                                      <Mail
                                        size={12}
                                      />
                                      {item.email}
                                    </span>
                                  )}

                                </div>

                              </div>

                            </Link>

                          </td>

                          <td className="px-4 py-4">

                            <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-700">
                              {item.employee_no}
                            </span>

                          </td>

                          <td className="px-4 py-4 text-sm font-semibold text-slate-700">
                            {label(
                              item.department
                            )}
                          </td>

                          <td className="px-4 py-4 text-sm font-semibold text-slate-700">
                            {label(
                              item.designation
                            )}
                          </td>

                          <td className="px-4 py-4 text-sm text-slate-600">
                            {label(
                              item.employment_type
                            )}
                          </td>

                          <td className="px-4 py-4">

                            <div className="flex flex-col items-start gap-1.5">

                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusClass(
                                  item.status
                                )}`}
                              >
                                {label(
                                  item.status
                                )}
                              </span>

                              {item.user_id && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600">
                                  <ShieldCheck
                                    size={11}
                                  />
                                  Login assigned
                                </span>
                              )}

                            </div>

                          </td>

                          <td className="px-6 py-4 text-right">

                            <Link
                              href={`/dashboard/staff/${item.id}`}
                              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
                            >
                              View
                              <ChevronRight
                                size={14}
                              />
                            </Link>

                          </td>

                        </tr>
                      )
                    )}

                  </tbody>

                </table>

              </div>

              {/* MOBILE */}

              <div className="grid gap-3 p-4 lg:hidden md:p-5">

                {filteredStaff.map(
                  (item) => (
                    <Link
                      key={item.id}
                      href={`/dashboard/staff/${item.id}`}
                      className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-blue-200 hover:shadow-sm"
                    >

                      <div className="flex items-start gap-3">

                        <Avatar
                          staff={item}
                        />

                        <div className="min-w-0 flex-1">

                          <div className="flex items-start justify-between gap-3">

                            <div className="min-w-0">

                              <h3 className="truncate font-bold text-slate-900">
                                {staffName(
                                  item
                                )}
                              </h3>

                              <p className="mt-1 text-xs font-semibold text-slate-500">
                                {item.employee_no}

                                {item.designation
                                  ? ` • ${item.designation}`
                                  : ""}
                              </p>

                            </div>

                            <ChevronRight
                              size={18}
                              className="shrink-0 text-slate-400"
                            />

                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">

                            <span
                              className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusClass(
                                item.status
                              )}`}
                            >
                              {label(
                                item.status
                              )}
                            </span>

                            {item.department && (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                                {item.department}
                              </span>
                            )}

                            {item.user_id && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                                <ShieldCheck
                                  size={11}
                                />
                                Login
                              </span>
                            )}

                          </div>

                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">

                            {item.phone && (
                              <span className="inline-flex items-center gap-1.5">
                                <Phone
                                  size={12}
                                />
                                {item.phone}
                              </span>
                            )}

                            {item.email && (
                              <span className="inline-flex items-center gap-1.5">
                                <Mail
                                  size={12}
                                />
                                {item.email}
                              </span>
                            )}

                          </div>

                        </div>

                      </div>

                    </Link>
                  )
                )}

              </div>
            </>
          )}

        </section>

        {/* FOOTER */}

        <div className="mt-5 flex flex-col gap-2 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">

          <p>
            Staff records are isolated to
            the active school.
          </p>

          {membership && (
            <p className="flex items-center gap-1.5">
              <ShieldCheck size={13} />

              Role:

              <span className="font-bold text-slate-500">
                {label(
                  membership.role
                )}
              </span>
            </p>
          )}

        </div>

      </div>
    </main>
  );
}

function ManagementCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
    >
      <div className="flex items-center justify-between">

        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-slate-600 transition group-hover:bg-blue-50 group-hover:text-blue-600">
          {icon}
        </div>

        <ChevronRight
          size={18}
          className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-500"
        />

      </div>

      <p className="mt-4 text-sm font-black text-slate-900">
        {title}
      </p>

      <p className="mt-1 text-xs leading-5 text-slate-500">
        {description}
      </p>
    </Link>
  );
}

function StatCard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: number;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

      <div className="flex items-start justify-between gap-3">

        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {title}
          </p>

          <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">
            {value}
          </p>

          <p className="mt-1 text-xs font-medium text-slate-500">
            {description}
          </p>
        </div>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          {icon}
        </div>

      </div>

    </div>
  );
}

function FilterSelect({
  label: fieldLabel,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (
    value: string
  ) => void;
  options: [string, string][];
}) {
  return (
    <div>

      <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400">
        {fieldLabel}
      </label>

      <select
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value
          )
        }
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
      >
        {options.map(
          ([
            optionValue,
            optionLabel,
          ]) => (
            <option
              key={optionValue}
              value={optionValue}
            >
              {optionLabel}
            </option>
          )
        )}
      </select>

    </div>
  );
}

function Avatar({
  staff,
}: {
  staff: Staff;
}) {
  if (staff.photo_url) {
    return (
      <img
        src={staff.photo_url}
        alt={staffName(staff)}
        className="h-11 w-11 shrink-0 rounded-xl object-cover"
      />
    );
  }

  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-sm font-black text-blue-600">
      {initials(staff)}
    </div>
  );
}