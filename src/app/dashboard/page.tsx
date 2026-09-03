/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  ArrowRight,
  Banknote,
  BarChart3,
  BookOpen,
  Building2,
  CalendarCheck,
  Check,
  ChevronRight,
  GraduationCap,
  IndianRupee,
  Landmark,
  ReceiptText,
  School,
  Settings2,
  ShieldCheck,
  Users,
  Wallet,
  WalletCards,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type School = {
  id: string;
  name: string;
  code: string | null;
  school_code: string | null;
  status: string;
  plan_code: string | null;
  student_limit: number | null;
  timezone: string | null;
  currency_code: string | null;
};

type Profile = {
  full_name: string | null;
};

type DashboardStats = {
  studentCount: number;
  classCount: number;
  feeCollection: number;
  expenses: number;
  attendancePercentage: number;
};

type QuickActionProps = {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
};

/*
|--------------------------------------------------------------------------
| Dashboard routes
|--------------------------------------------------------------------------
| Keep all accounting routes here in one place so old dashboard URLs
| do not accidentally come back.
*/
const ACCOUNTING_ROUTES = {
  accounts: "/accounting/accounts",
  openingBalance: "/accounting/opening-balance",
  cashBank: "/accounting/cash-bank",
  receipt: "/accounting/receipt",
  payment: "/accounting/payment",
  contra: "/accounting/contra",
  journal: "/accounting/journal",
  ledger: "/accounting/ledger",
  bankReconciliation: "/accounting/bank-reconciliation",
  trialBalance: "/accounting/trial-balance",
  profitLoss: "/accounting/profit-loss",
  balanceSheet: "/accounting/balance-sheet",
} as const;

const QUICK_ACTIONS: QuickActionProps[] = [
  // SCHOOL MANAGEMENT
  {
    title: "Students",
    description: "Add and manage students",
    href: "/dashboard/students",
    icon: <GraduationCap size={20} />,
  },
  {
    title: "Classes & Sections",
    description: "Manage classes and sections",
    href: "/dashboard/classes",
    icon: <School size={20} />,
  },
  {
    title: "Fees",
    description: "Bills and fee collections",
    href: "/dashboard/fees",
    icon: <IndianRupee size={20} />,
  },
  {
    title: "Attendance",
    description: "Record daily attendance",
    href: "/dashboard/attendance",
    icon: <CalendarCheck size={20} />,
  },
  {
    title: "Expenses",
    description: "Track school expenses",
    href: "/dashboard/expenses",
    icon: <ReceiptText size={20} />,
  },

  // OTHER
  {
    title: "Staff",
    description: "Manage school staff",
    href: "/dashboard/staff",
    icon: <Users size={20} />,
  },
  {
    title: "Payroll",
    description: "Manage monthly staff payroll",
    href: "/dashboard/payroll",
    icon: <Banknote size={20} />,
  },
  {
    title: "Reports",
    description: "School reports",
    href: "/dashboard/reports",
    icon: <BarChart3 size={20} />,
  },
];

export default function DashboardPage() {
  const [school, setSchool] = useState<School | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const [stats, setStats] = useState<DashboardStats>({
    studentCount: 0,
    classCount: 0,
    feeCollection: 0,
    expenses: 0,
    attendancePercentage: 0,
  });

  const [role, setRole] = useState("owner");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      setLoading(true);
      setError("");

      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/login";
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from("school_users")
        .select("school_id, role, is_active")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (membershipError) {
        throw membershipError;
      }

      if (!membership) {
        setError("Your account is not assigned to a school.");
        return;
      }

      const [
        { data: profileData },
        { data: schoolData, error: schoolError },
      ] = await Promise.all([
        supabase
          .from("user_profiles")
          .select("full_name")
          .eq("id", user.id)
          .maybeSingle(),

        supabase
          .from("schools")
          .select(
            "id, name, code, school_code, status, plan_code, student_limit, timezone, currency_code",
          )
          .eq("id", membership.school_id)
          .maybeSingle(),
      ]);

      if (schoolError) {
        throw schoolError;
      }

      if (!schoolData) {
        setError("School information could not be found.");
        return;
      }

      if (schoolData.status === "suspended") {
        await supabase.auth.signOut();
        window.location.href = "/login";
        return;
      }

      setProfile(profileData || null);
      setSchool(schoolData);
      setRole(membership.role || "owner");

      /*
       * Keep school information for existing dashboard functionality.
       */
      if (typeof window !== "undefined") {
        sessionStorage.setItem("school_id", membership.school_id);
        sessionStorage.setItem("school_name", schoolData.name || "");
        sessionStorage.setItem("school_role", membership.role || "");
      }

      const now = new Date();

      const monthStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      );

      const nextMonthStart = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        1,
      );

      const monthStartDate =
        `${monthStart.getFullYear()}-${String(
          monthStart.getMonth() + 1,
        ).padStart(2, "0")}-01`;

      const nextMonthStartDate =
        `${nextMonthStart.getFullYear()}-${String(
          nextMonthStart.getMonth() + 1,
        ).padStart(2, "0")}-01`;

      const todayDate =
        `${now.getFullYear()}-${String(
          now.getMonth() + 1,
        ).padStart(2, "0")}-${String(
          now.getDate(),
        ).padStart(2, "0")}`;

      const [
        studentResult,
        classResult,
        paymentResult,
        expenseResult,
        attendanceResult,
      ] = await Promise.all([
        supabase
          .from("students")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("school_id", membership.school_id),

        supabase
          .from("classes")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("school_id", membership.school_id),

        supabase
          .from("fee_payments")
          .select("amount")
          .eq("school_id", membership.school_id)
          .gte("payment_date", monthStartDate)
          .lt("payment_date", nextMonthStartDate),

        supabase
          .from("expenses")
          .select("amount")
          .eq("school_id", membership.school_id)
          .gte("expense_date", monthStartDate)
          .lt("expense_date", nextMonthStartDate),

        supabase
          .from("student_attendance")
          .select("status")
          .eq("school_id", membership.school_id)
          .eq("attendance_date", todayDate),
      ]);

      if (studentResult.error) {
        throw studentResult.error;
      }

      if (classResult.error) {
        throw classResult.error;
      }

      if (paymentResult.error) {
        throw paymentResult.error;
      }

      if (expenseResult.error) {
        throw expenseResult.error;
      }

      if (attendanceResult.error) {
        throw attendanceResult.error;
      }

      const feeCollection = (paymentResult.data || []).reduce(
        (total, row) => total + Number(row.amount || 0),
        0,
      );

      const expenses = (expenseResult.data || []).reduce(
        (total, row) => total + Number(row.amount || 0),
        0,
      );

      const attendanceRows = attendanceResult.data || [];
      const attendanceTotal = attendanceRows.length;

      const attendanceScore = attendanceRows.reduce(
        (total, row) => {
          const status = String(row.status || "").toLowerCase();

          if (status === "present" || status === "late") {
            return total + 1;
          }

          if (status === "half_day") {
            return total + 0.5;
          }

          return total;
        },
        0,
      );

      const attendancePercentage =
        attendanceTotal > 0
          ? Math.round(
              (attendanceScore / attendanceTotal) * 100,
            )
          : 0;

      setStats({
        studentCount: studentResult.count || 0,
        classCount: classResult.count || 0,
        feeCollection,
        expenses,
        attendancePercentage,
      });
    } catch (loadError) {
      console.error("DASHBOARD ERROR:", loadError);

      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }

  const displayName = profile?.full_name || "School Owner";

  const studentLimit = school?.student_limit || 0;

  const studentPercentage = useMemo(() => {
    if (!studentLimit) {
      return 0;
    }

    return Math.min(
      100,
      Math.round(
        (stats.studentCount / studentLimit) * 100,
      ),
    );
  }, [stats.studentCount, studentLimit]);

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-slate-200 bg-white px-8 py-7 text-center shadow-sm">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />

          <p className="text-sm font-medium text-slate-600">
            Loading school dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-red-100 p-2 text-red-600">
              <ShieldCheck size={20} />
            </div>

            <div>
              <h2 className="text-lg font-bold text-red-800">
                Unable to load dashboard
              </h2>

              <p className="mt-2 text-sm leading-6 text-red-700">
                {error}
              </p>

              <button
                type="button"
                onClick={() => void loadDashboard()}
                className="mt-5 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!school) {
    return null;
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">

        {/* PAGE HEADER */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">
              School Management Dashboard
            </p>

            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              Overview
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/classes"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-blue-600"
            >
              <Settings2 size={16} />
              Manage Classes
            </Link>

            <Link
              href="/dashboard/students/new"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              <GraduationCap size={16} />
              Add Student
            </Link>
          </div>
        </div>

        {/* WELCOME */}
        <section className="overflow-hidden rounded-3xl bg-blue-600 p-6 text-white shadow-lg md:p-8">
          <div className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
            <div>
              <p className="text-sm font-medium text-blue-100">
                Welcome back
              </p>

              <h2 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
                {displayName}
              </h2>

              <div className="mt-3 flex items-center gap-2 text-sm text-blue-100">
                <Building2 size={16} />
                <span>{school.name}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <DashboardBadge
                label="School Code"
                value={
                  school.school_code ||
                  school.code ||
                  "—"
                }
              />

              <DashboardBadge
                label="Status"
                value={school.status || "trial"}
              />

              <DashboardBadge
                label="Plan"
                value={school.plan_code || "starter"}
              />
            </div>
          </div>
        </section>

        {/* STAT CARDS */}
        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Students"
            value={String(stats.studentCount)}
            subtitle={
              studentLimit
                ? `Limit ${studentLimit}`
                : "Student records"
            }
            icon={<GraduationCap size={21} />}
          />

          <StatCard
            title="Classes"
            value={String(stats.classCount)}
            subtitle="Active school classes"
            icon={<School size={21} />}
          />

          <StatCard
            title="Fee Collection"
            value={formatINR(stats.feeCollection)}
            subtitle="This month"
            icon={<IndianRupee size={21} />}
          />

          <StatCard
            title="Expenses"
            value={formatINR(stats.expenses)}
            subtitle="This month"
            icon={<ReceiptText size={21} />}
          />
        </section>

        {/* SECONDARY STATS */}
        <section className="mt-4 grid gap-4 sm:grid-cols-2">
          <StatCard
            title="Attendance"
            value={`${stats.attendancePercentage}%`}
            subtitle="Today"
            icon={<Check size={21} />}
          />

          <StatCard
            title="School Status"
            value={
              school.status
                ? school.status.charAt(0).toUpperCase() +
                  school.status.slice(1)
                : "Active"
            }
            subtitle={`${role} account`}
            icon={<ShieldCheck size={21} />}
          />
        </section>

        {/* CAPACITY */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-bold text-slate-900">
                Student Capacity
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                {stats.studentCount} of{" "}
                {studentLimit || "—"} students
              </p>
            </div>

            <span className="text-sm font-bold text-blue-600">
              {studentPercentage}%
            </span>
          </div>

          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-500"
              style={{
                width: `${studentPercentage}%`,
              }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
            <span>
              {stats.studentCount} students registered
            </span>

            <span>
              {studentLimit
                ? `${Math.max(
                    studentLimit - stats.studentCount,
                    0,
                  )} seats remaining`
                : "No limit configured"}
            </span>
          </div>
        </section>

        {/* QUICK ACTIONS */}
        <section className="mt-8">
          <div className="mb-4">
            <h2 className="text-xl font-bold text-slate-900">
              School Actions
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Common school management tasks.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {QUICK_ACTIONS.map((action) => (
              <QuickAction
                key={`${action.href}-${action.title}`}
                {...action}
              />
            ))}
          </div>
        </section>

        {/* ACCOUNTING CONTROL CENTER */}
        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-600">
                Accounting
              </p>

              <h2 className="mt-1 text-xl font-bold text-slate-900">
                Accounting Control Center
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Manage accounts, opening balance, cash, bank and final accounts.
              </p>
            </div>

            <span className="inline-flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700">
              <BookOpen size={16} />
              Accounting
            </span>
          </div>

          {/* ACCOUNTING NAVIGATION — all accounting modules in one place */}
          <div className="mt-5 space-y-5">
            <AccountingGroup title="Setup & Daily Books">
              <AccountingShortcut
                href={ACCOUNTING_ROUTES.accounts}
                icon={<BookOpen size={19} />}
                title="Chart of Accounts"
                description="Create and manage ledgers"
              />

              <AccountingShortcut
                href={ACCOUNTING_ROUTES.openingBalance}
                icon={<WalletCards size={19} />}
                title="Opening Balance"
                description="Set financial year opening balances"
              />

              <AccountingShortcut
                href={ACCOUNTING_ROUTES.cashBank}
                icon={<Wallet size={19} />}
                title="Cash Book"
                description="View cash receipts and payments"
              />

              <AccountingShortcut
                href={ACCOUNTING_ROUTES.cashBank}
                icon={<Landmark size={19} />}
                title="Bank Book"
                description="View bank and UPI transactions"
              />

              <AccountingShortcut
                href={ACCOUNTING_ROUTES.receipt}
                icon={<ReceiptText size={19} />}
                title="Receipt"
                description="Record money received"
              />

              <AccountingShortcut
                href={ACCOUNTING_ROUTES.payment}
                icon={<Banknote size={19} />}
                title="Payment"
                description="Record school payments"
              />

              <AccountingShortcut
                href={ACCOUNTING_ROUTES.contra}
                icon={<ArrowRight size={19} />}
                title="Contra"
                description="Transfer between cash and bank"
              />

              <AccountingShortcut
                href={ACCOUNTING_ROUTES.journal}
                icon={<BookOpen size={19} />}
                title="Journal"
                description="Create manual journal entries"
              />
            </AccountingGroup>

            <AccountingGroup title="Reports & Final Accounts">
              <AccountingShortcut
                href={ACCOUNTING_ROUTES.ledger}
                icon={<BookOpen size={19} />}
                title="General Ledger"
                description="View every account ledger"
              />

              <AccountingShortcut
                href={ACCOUNTING_ROUTES.bankReconciliation}
                icon={<Landmark size={19} />}
                title="Bank Reconciliation"
                description="Match bank book with statement"
              />

              <AccountingShortcut
                href={ACCOUNTING_ROUTES.trialBalance}
                icon={<BarChart3 size={19} />}
                title="Trial Balance"
                description="Check debit and credit balances"
              />

              <AccountingShortcut
                href={ACCOUNTING_ROUTES.profitLoss}
                icon={<BarChart3 size={19} />}
                title="Profit & Loss"
                description="View income and expenses"
              />

              <AccountingShortcut
                href={ACCOUNTING_ROUTES.balanceSheet}
                icon={<Building2 size={19} />}
                title="Balance Sheet"
                description="View assets, liabilities and equity"
              />
            </AccountingGroup>
          </div>
        </section>

        {/* SCHOOL INFORMATION + ACCOUNT */}
        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Building2 size={19} />
              </div>

              <div>
                <h2 className="font-bold text-slate-900">
                  School Information
                </h2>

                <p className="mt-0.5 text-xs text-slate-500">
                  Your current school account details
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <InfoRow
                label="School Name"
                value={school.name}
              />

              <InfoRow
                label="School Code"
                value={
                  school.school_code ||
                  school.code ||
                  "—"
                }
              />

              <InfoRow
                label="Plan"
                value={school.plan_code || "Starter"}
              />

              <InfoRow
                label="Status"
                value={school.status || "Active"}
              />

              <InfoRow
                label="Currency"
                value={school.currency_code || "INR"}
              />

              <InfoRow
                label="Timezone"
                value={school.timezone || "Asia/Kolkata"}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <WalletCards size={19} />
              </div>

              <div>
                <h2 className="font-bold text-slate-900">
                  Account
                </h2>

                <p className="mt-0.5 text-xs text-slate-500">
                  Your SchoolFlow account
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl bg-slate-50 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Current Role
                  </p>

                  <p className="mt-1 text-lg font-bold capitalize text-slate-900">
                    {role}
                  </p>
                </div>

                <div className="rounded-xl bg-white p-3 text-blue-600 shadow-sm">
                  <ShieldCheck size={20} />
                </div>
              </div>

              <div className="mt-5 border-t border-slate-200 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Support
                </p>

                <p className="mt-2 text-sm leading-6 text-slate-600">
                  For assistance with your school account,
                  contact SchoolFlow support.
                </p>

                <a
                  href="tel:7780670760"
                  className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-700"
                >
                  7780670760
                  <ArrowRight size={14} />
                </a>
              </div>
            </div>
          </div>
        </section>


      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatINR(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function DashboardBadge({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <span className="rounded-full bg-white/15 px-4 py-2 text-xs font-semibold backdrop-blur-sm">
      {label}: {value}
    </span>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">
            {title}
          </p>

          <p className="mt-2 truncate text-3xl font-bold tracking-tight text-slate-900">
            {value}
          </p>

          <p className="mt-1 text-xs text-slate-400">
            {subtitle}
          </p>
        </div>

        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          {icon}
        </div>
      </div>
    </div>
  );
}

function QuickAction({
  title,
  description,
  href,
  icon,
}: QuickActionProps) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition group-hover:bg-blue-600 group-hover:text-white">
          {icon}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold text-slate-900">
              {title}
            </h3>

            <ChevronRight
              size={16}
              className="mt-0.5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-600"
            />
          </div>

          <p className="mt-1 text-xs leading-5 text-slate-500">
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
}

function AccountingGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          {title}
        </h3>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {children}
      </div>
    </div>
  );
}

function AccountingShortcut({
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
      className="group block rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm group-hover:bg-blue-600 group-hover:text-white">
          {icon}
        </div>

        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900">
            {title}
          </p>

          <p className="mt-0.5 text-xs text-slate-500">
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-slate-500">
        {label}
      </span>

      <span className="max-w-[60%] truncate text-right text-sm font-semibold capitalize text-slate-800">
        {value}
      </span>
    </div>
  );
}

function BottomLink({
  href,
  icon,
  text,
}: {
  href: string;
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
    >
      {icon}
      {text}
    </Link>
  );
}