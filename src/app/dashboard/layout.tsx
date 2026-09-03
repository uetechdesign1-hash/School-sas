"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  LayoutDashboard,
  CalendarCheck,
  CalendarDays,
  WalletCards,
  FileText,
  UserRound,
  Users,
  GraduationCap,
  IndianRupee,
  ReceiptText,
  Wallet,
  Landmark,
  BarChart3,
  LogOut,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Props = {
  children: ReactNode;
};

type MenuItem = {
  name: string;
  href: string;
  icon: ReactNode;
};

/* =========================================================
   PRINCIPAL / ADMIN MENU
   ========================================================= */

const PRINCIPAL_MENU: MenuItem[] = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: <LayoutDashboard size={18} />,
  },
  {
    name: "Students",
    href: "/dashboard/students",
    icon: <GraduationCap size={18} />,
  },
  {
    name: "Fees",
    href: "/dashboard/fees/structure",
    icon: <IndianRupee size={18} />,
  },
  {
    name: "Attendance",
    href: "/dashboard/attendance",
    icon: <CalendarCheck size={18} />,
  },
  {
    name: "Expenses",
    href: "/dashboard/expenses",
    icon: <ReceiptText size={18} />,
  },
  {
    name: "Cash Book",
    href: "/dashboard/cash-book",
    icon: <Wallet size={18} />,
  },
  {
    name: "Bank Book",
    href: "/dashboard/bank-book",
    icon: <Landmark size={18} />,
  },
  {
    name: "Staff",
    href: "/dashboard/staff",
    icon: <Users size={18} />,
  },
  {
    name: "Reports",
    href: "/dashboard/reports",
    icon: <BarChart3 size={18} />,
  },
];

/* =========================================================
   STAFF PORTAL MENU
   ========================================================= */

const STAFF_MENU: MenuItem[] = [
  {
    name: "Dashboard",
    href: "/dashboard/staff/home",
    icon: <LayoutDashboard size={18} />,
  },
  {
    name: "My Attendance",
    href: "/dashboard/staff/attendance",
    icon: <CalendarCheck size={18} />,
  },
  {
    name: "Attendance History",
    href: "/dashboard/staff/my-attendance",
    icon: <CalendarDays size={18} />,
  },
  {
    name: "My Salary",
    href: "/dashboard/staff/my-salary",
    icon: <WalletCards size={18} />,
  },
  {
    name: "My Payslips",
    href: "/dashboard/staff/my-payslips",
    icon: <FileText size={18} />,
  },
  {
    name: "My Profile",
    href: "/dashboard/staff/profile",
    icon: <UserRound size={18} />,
  },
];

/* =========================================================
   STAFF ALLOWED ROUTES
   ========================================================= */

const STAFF_ALLOWED_ROUTES = [
  "/dashboard/staff/home",
  "/dashboard/staff/attendance",
  "/dashboard/staff/my-attendance",
  "/dashboard/staff/my-salary",
  "/dashboard/staff/my-payslips",
  "/dashboard/staff/profile",
];

/* =========================================================
   ROLE HELPERS
   ========================================================= */

function normalizeRole(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isStaffRouteAllowed(pathname: string) {
  return STAFF_ALLOWED_ROUTES.some(
    (route) =>
      pathname === route ||
      pathname.startsWith(`${route}/`)
  );
}

/* =========================================================
   DASHBOARD LAYOUT
   ========================================================= */

export default function DashboardLayout({
  children,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [schoolName, setSchoolName] =
    useState("SchoolFlow");

  const [role, setRole] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  /* =======================================================
     LOAD AUTH / SCHOOL / ROLE
     ======================================================= */

  useEffect(() => {
    let cancelled = false;

    async function loadSchool() {
      try {
        setLoading(true);

        /* -----------------------------------------------
           CURRENT USER
           ----------------------------------------------- */

        const {
          data: {
            user,
          },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          console.error(
            "AUTH USER ERROR:",
            userError
          );

          router.replace("/login");
          return;
        }

        if (!user) {
          router.replace("/login");
          return;
        }

        /* -----------------------------------------------
           ACTIVE SCHOOL MEMBERSHIP
           ----------------------------------------------- */

        const {
          data: membership,
          error: membershipError,
        } = await supabase
          .from("school_users")
          .select(
            `
              school_id,
              role,
              is_active
            `
          )
          .eq(
            "user_id",
            user.id
          )
          .eq(
            "is_active",
            true
          )
          .limit(1)
          .maybeSingle();

        if (membershipError) {
          console.error(
            "MEMBERSHIP ERROR:",
            membershipError
          );

          router.replace("/login");
          return;
        }

        if (!membership) {
          console.error(
            "NO ACTIVE SCHOOL MEMBERSHIP"
          );

          router.replace("/login");
          return;
        }

        /* -----------------------------------------------
           ROLE
           ----------------------------------------------- */

        const currentRole =
          normalizeRole(
            membership.role
          );

        /* -----------------------------------------------
           STAFF ROUTE PROTECTION
           -----------------------------------------------

           IMPORTANT:

           /dashboard/staff

           is the ADMIN STAFF DIRECTORY.

           Therefore a Staff user must NOT be allowed
           to enter it.

           Staff can only use their personal portal
           routes listed in STAFF_ALLOWED_ROUTES.
           ----------------------------------------------- */

        if (
          currentRole === "staff" &&
          !isStaffRouteAllowed(pathname)
        ) {
          router.replace(
            "/dashboard/staff/home"
          );

          return;
        }

        /* -----------------------------------------------
           SCHOOL
           ----------------------------------------------- */

        const {
          data: school,
          error: schoolError,
        } = await supabase
          .from("schools")
          .select(
            `
              id,
              name,
              status
            `
          )
          .eq(
            "id",
            membership.school_id
          )
          .maybeSingle();

        if (schoolError) {
          console.error(
            "SCHOOL ERROR:",
            schoolError
          );

          router.replace("/login");
          return;
        }

        if (!school) {
          console.error(
            "SCHOOL NOT FOUND"
          );

          router.replace("/login");
          return;
        }

        /* -----------------------------------------------
           SUSPENDED SCHOOL
           ----------------------------------------------- */

        if (
          school.status ===
          "suspended"
        ) {
          await supabase.auth.signOut();

          router.replace("/login");
          return;
        }

        if (cancelled) {
          return;
        }

        /* -----------------------------------------------
           SAVE STATE
           ----------------------------------------------- */

        setSchoolName(
          school.name ||
            "SchoolFlow"
        );

        setRole(
          currentRole
        );

        sessionStorage.setItem(
          "school_id",
          membership.school_id
        );

        sessionStorage.setItem(
          "school_name",
          school.name || ""
        );

        sessionStorage.setItem(
          "school_role",
          currentRole
        );

        /* -----------------------------------------------
           STAFF ACCOUNT VERIFICATION
           ----------------------------------------------- */

        if (
          currentRole === "staff"
        ) {
          const {
            data: staff,
            error: staffError,
          } = await supabase
            .from("staff")
            .select(
              `
                id,
                school_id,
                user_id,
                status
              `
            )
            .eq(
              "user_id",
              user.id
            )
            .eq(
              "school_id",
              membership.school_id
            )
            .maybeSingle();

          if (staffError) {
            console.error(
              "STAFF AUTH ERROR:",
              staffError
            );

            await supabase.auth.signOut();

            router.replace("/login");
            return;
          }

          /* ---------------------------------------------
             LOGIN MUST BE LINKED TO STAFF
             --------------------------------------------- */

          if (!staff) {
            console.error(
              "STAFF AUTH ERROR: Login is not linked to a staff member."
            );

            await supabase.auth.signOut();

            router.replace("/login");
            return;
          }

          /* ---------------------------------------------
             STAFF MUST BE ACTIVE
             --------------------------------------------- */

          if (
            staff.status &&
            staff.status !== "active"
          ) {
            console.error(
              "STAFF AUTH ERROR: Staff account is inactive."
            );

            await supabase.auth.signOut();

            router.replace("/login");
            return;
          }
        }
      } catch (error) {
        console.error(
          "DASHBOARD AUTH ERROR:",
          error
        );

        router.replace("/login");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSchool();

    return () => {
      cancelled = true;
    };
  }, [
    pathname,
    router,
    supabase,
  ]);

  /* =======================================================
     SIGN OUT
     ======================================================= */

  async function handleSignOut() {
    try {
      setLoading(true);

      await supabase.auth.signOut();

      sessionStorage.removeItem(
        "school_id"
      );

      sessionStorage.removeItem(
        "school_name"
      );

      sessionStorage.removeItem(
        "school_role"
      );

      sessionStorage.removeItem(
        "platform_role"
      );

      window.location.href =
        "/login";
    } catch (error) {
      console.error(
        "SIGN OUT ERROR:",
        error
      );

      window.location.href =
        "/login";
    }
  }

  /* =======================================================
     LOADING SCREEN
     ======================================================= */

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">

        <div className="rounded-2xl border border-slate-200 bg-white px-8 py-6 text-center shadow-sm">

          <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />

          <p className="text-sm font-medium text-slate-600">
            Loading dashboard...
          </p>

        </div>

      </main>
    );
  }

  /* =======================================================
     SELECT MENU
     ======================================================= */

  const isStaff =
    role === "staff";

  const menu =
    isStaff
      ? STAFF_MENU
      : PRINCIPAL_MENU;

  /* =======================================================
     RENDER
     ======================================================= */

  return (
    <div className="min-h-screen bg-slate-50">

      {/* =================================================
          TOP BAR
          ================================================= */}

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">

        <div className="flex h-16 items-center justify-between px-4 md:px-6">

          {/* SCHOOL BRAND */}

          <div className="flex items-center gap-3">

            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white">
              S
            </div>

            <div>

              <h1 className="text-lg font-bold text-slate-900">
                {schoolName}
              </h1>

              <p className="text-xs text-slate-500">
                {isStaff
                  ? "Staff Portal"
                  : "School Management"}
              </p>

            </div>

          </div>

          {/* ROLE + SIGN OUT */}

          <div className="flex items-center gap-3">

            <div className="hidden text-right sm:block">

              <p className="text-xs font-medium text-slate-500">
                Role
              </p>

              <p className="text-sm font-semibold capitalize text-slate-800">
                {role}
              </p>

            </div>

            <button
              type="button"
              onClick={
                handleSignOut
              }
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <LogOut
                size={16}
              />

              <span>
                Sign Out
              </span>
            </button>

          </div>

        </div>

      </header>

      <div className="mx-auto flex max-w-7xl">

        {/* =================================================
            DESKTOP SIDEBAR
            ================================================= */}

        <aside className="hidden min-h-[calc(100vh-4rem)] w-64 shrink-0 border-r border-slate-200 bg-white md:block">

          <nav className="space-y-1 p-4">

            {menu.map(
              (item) => {

                const active =
                  pathname ===
                    item.href ||
                  (
                    item.href !==
                      "/dashboard" &&
                    pathname.startsWith(
                      `${item.href}/`
                    )
                  );

                return (
                  <Link
                    key={
                      item.href
                    }
                    href={
                      item.href
                    }
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition ${
                      active
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >

                    <span className="flex w-6 items-center justify-center">
                      {
                        item.icon
                      }
                    </span>

                    <span>
                      {
                        item.name
                      }
                    </span>

                  </Link>
                );
              }
            )}

          </nav>

          {/* SUPPORT */}

          <div className="mx-4 mt-4 rounded-2xl bg-slate-50 p-4">

            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Need Help?
            </p>

            <p className="mt-2 text-sm text-slate-600">
              Contact SchoolFlow support.
            </p>

            <a
              href="tel:7780670760"
              className="mt-3 block text-sm font-semibold text-blue-600"
            >
              7780670760
            </a>

          </div>

        </aside>

        {/* =================================================
            MOBILE NAVIGATION
            ================================================= */}

        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white md:hidden">

          <div className="flex overflow-x-auto px-2 py-2">

            {menu.map(
              (item) => {

                const active =
                  pathname ===
                    item.href ||
                  (
                    item.href !==
                      "/dashboard" &&
                    pathname.startsWith(
                      `${item.href}/`
                    )
                  );

                return (
                  <Link
                    key={
                      item.href
                    }
                    href={
                      item.href
                    }
                    className={`flex min-w-[100px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center text-[11px] font-semibold ${
                      active
                        ? "bg-blue-600 text-white"
                        : "text-slate-500 hover:bg-slate-100"
                    }`}
                  >

                    {
                      item.icon
                    }

                    <span>
                      {
                        item.name
                      }
                    </span>

                  </Link>
                );
              }
            )}

          </div>

        </div>

        {/* =================================================
            PAGE CONTENT
            ================================================= */}

        <main className="min-w-0 flex-1 pb-20 md:pb-0">
          {children}
        </main>

      </div>

    </div>
  );
}