"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Bell,
  BookOpen,
  Bus,
  CalendarCheck,
  ChevronDown,
  CreditCard,
  DollarSign,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const navigation = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Students",
    href: "/dashboard/students",
    icon: GraduationCap,
  },
  {
    label: "Admissions",
    href: "/dashboard/admissions",
    icon: FileText,
  },
  {
    label: "Fees",
    href: "/dashboard/fees",
    icon: CreditCard,
  },
  {
    label: "Payments",
    href: "/dashboard/payments",
    icon: Wallet,
  },
  {
    label: "Transport",
    href: "/dashboard/transport",
    icon: Bus,
  },
  {
    label: "Attendance",
    href: "/dashboard/attendance",
    icon: CalendarCheck,
  },
  {
    label: "Staff & Payroll",
    href: "/dashboard/staff",
    icon: Users,
  },
  {
    label: "Accounts",
    href: "/dashboard/accounts",
    icon: DollarSign,
  },
  {
    label: "Reports",
    href: "/dashboard/reports",
    icon: BarChart3,
  },
];

type Props = {
  children: React.ReactNode;
  schoolName: string;
  userName: string;
  userEmail: string;
  role: string;
};

export function DashboardShell({
  children,
  schoolName,
  userName,
  userEmail,
  role,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  async function handleLogout() {
    await supabase.auth.signOut();

    router.push("/login");
    router.refresh();
  }

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-5">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 font-bold text-white">
            S
          </div>

          <div className="min-w-0">
            <div className="font-bold text-slate-900">SchoolFlow</div>

            <div className="truncate text-xs text-slate-500">
              {schoolName}
            </div>
          </div>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-5">
        <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Main Menu
        </p>

        <nav className="space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;

            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <Icon size={19} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <p className="mb-3 mt-8 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          System
        </p>

        <Link
          href="/dashboard/settings"
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
            pathname.startsWith("/dashboard/settings")
              ? "bg-blue-50 text-blue-700"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <Settings size={19} />
          Settings
        </Link>
      </div>

      <div className="border-t border-slate-200 p-4">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Logged in as</p>

          <p className="mt-1 truncate text-sm font-semibold text-slate-900">
            {role}
          </p>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <div className="fixed inset-y-0 left-0 hidden lg:block">
        {sidebar}
      </div>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
          />

          <div className="relative h-full w-72">{sidebar}</div>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex h-16 items-center justify-between px-4 sm:px-6">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <Menu size={22} />
            </button>

            <div className="hidden lg:block">
              <p className="text-sm font-medium text-slate-500">
                School Management
              </p>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <button className="relative rounded-xl p-2.5 text-slate-500 hover:bg-slate-100">
                <Bell size={20} />

                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" />
              </button>

              <div className="relative">
                <button
                  onClick={() => setProfileOpen(!profileOpen)}
                  className="flex items-center gap-2 rounded-xl p-1.5 hover:bg-slate-100"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">
                    {userName?.charAt(0)?.toUpperCase() || "U"}
                  </div>

                  <div className="hidden text-left sm:block">
                    <p className="max-w-32 truncate text-sm font-semibold text-slate-900">
                      {userName || "User"}
                    </p>

                    <p className="text-xs text-slate-500">{role}</p>
                  </div>

                  <ChevronDown size={16} className="hidden sm:block" />
                </button>

                {profileOpen && (
                  <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                    <div className="border-b border-slate-100 px-3 py-3">
                      <p className="font-semibold text-slate-900">
                        {userName}
                      </p>

                      <p className="mt-1 truncate text-xs text-slate-500">
                        {userEmail}
                      </p>
                    </div>

                    <Link
                      href="/dashboard/settings"
                      onClick={() => setProfileOpen(false)}
                      className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
                    >
                      <Settings size={17} />
                      Settings
                    </Link>

                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-red-600 hover:bg-red-50"
                    >
                      <LogOut size={17} />
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>

            {mobileOpen && (
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute right-4 rounded-lg p-2 lg:hidden"
              >
                <X size={22} />
              </button>
            )}
          </div>
        </header>

        <main>{children}</main>
      </div>
    </div>
  );
}