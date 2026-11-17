"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  FileText,
  GraduationCap,
  IndianRupee,
  Menu,
  Receipt,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const features = [
  {
    icon: GraduationCap,
    title: "Student Management",
    description:
      "Manage students, classes, sections, academic years and student information from one central platform.",
  },
  {
    icon: Users,
    title: "Staff & Teacher Management",
    description:
      "Manage staff profiles, designations, salary structures, attendance, payroll and payslips.",
  },
  {
    icon: ClipboardCheck,
    title: "Smart Attendance",
    description:
      "Track staff attendance, check-in, check-out, working hours, holidays, weekly offs and reports.",
  },
  {
    icon: IndianRupee,
    title: "Fee Management",
    description:
      "Create fee structures, record payments, generate receipts and keep fee collections organized.",
  },
  {
    icon: Wallet,
    title: "Payroll",
    description:
      "Calculate salaries based on attendance, payable days and deductions and generate payslips.",
  },
  {
    icon: Receipt,
    title: "Expenses",
    description:
      "Record school expenses, organize spending and understand where your school's money is going.",
  },
  {
    icon: CreditCard,
    title: "Accounting",
    description:
      "Manage accounts, transactions, payments and financial records in one connected system.",
  },
  {
    icon: BarChart3,
    title: "Reports & Analytics",
    description:
      "Get useful attendance, financial, payroll and administrative reports for better decisions.",
  },
];

const stats = [
  { value: "01", label: "Unified Platform" },
  { value: "08+", label: "Core Modules" },
  { value: "24/7", label: "Cloud Access" },
  { value: "100%", label: "School Focused" },
];

const metricTones = [
  "border-blue-100 bg-blue-50/80 text-blue-700",
  "border-violet-100 bg-violet-50/80 text-violet-700",
  "border-emerald-100 bg-emerald-50/80 text-emerald-700",
  "border-amber-100 bg-amber-50/80 text-amber-700",
];

const featureTones = [
  "bg-blue-100 text-blue-700 group-hover:bg-blue-600",
  "bg-violet-100 text-violet-700 group-hover:bg-violet-600",
  "bg-emerald-100 text-emerald-700 group-hover:bg-emerald-600",
  "bg-amber-100 text-amber-700 group-hover:bg-amber-500",
  "bg-rose-100 text-rose-700 group-hover:bg-rose-600",
  "bg-cyan-100 text-cyan-700 group-hover:bg-cyan-600",
  "bg-indigo-100 text-indigo-700 group-hover:bg-indigo-600",
  "bg-fuchsia-100 text-fuchsia-700 group-hover:bg-fuchsia-600",
];

type ReportPreview = {
  schoolName: string;
  students: number;
  staff: number;
  classes: number;
  attendance: number | null;
  feeCollection: number;
  expenses: number;
  monthLabel: string;
  monthly: { key: string; label: string; fees: number; expenses: number }[];
};

function formatCompactINR(value: number) {
  return `₹${new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)}`;
}

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [platformLogo, setPlatformLogo] = useState<string | null>(null);
  const [reportPreview, setReportPreview] = useState<ReportPreview | null>(null);
  const [reportPreviewReady, setReportPreviewReady] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  useEffect(() => {
    let mounted = true;

    async function loadPlatformLogo() {
      try {
        const { data, error } = await supabase.rpc("get_platform_logo");
        if (error) throw error;
        if (mounted) {
          setPlatformLogo(typeof data === "string" ? data : null);
        }
      } catch (logoError) {
        console.error("PLATFORM LOGO ERROR:", logoError);
      }
    }

    void loadPlatformLogo();

    return () => {
      mounted = false;
    };
  }, [supabase]);

  useEffect(() => {
    let mounted = true;

    async function refreshPreview() {
      try {
        const response = await fetch("/api/public-school-report", { cache: "no-store" });
        if (!response.ok) throw new Error("Report preview unavailable");
        const report = (await response.json()) as ReportPreview;
        if (mounted) setReportPreview(report);
      } catch {
        if (mounted) setReportPreview(null);
      } finally {
        if (mounted) setReportPreviewReady(true);
      }
    }

    void refreshPreview();
    const refreshTimer = window.setInterval(() => void refreshPreview(), 30_000);

    return () => {
      mounted = false;
      window.clearInterval(refreshTimer);
    };
  }, []);

  const previewMetrics = [
    { label: "Students", value: reportPreview?.students != null ? reportPreview.students.toLocaleString("en-IN") : "1,240" },
    { label: "Staff", value: reportPreview?.staff != null ? reportPreview.staff.toLocaleString("en-IN") : "76" },
    { label: "Attendance", value: reportPreview?.attendance != null ? `${reportPreview.attendance}%` : "92%" },
    { label: "Fees · this month", value: reportPreview ? formatCompactINR(reportPreview.feeCollection) : "₹2.4L" },
  ];

  const chartMax = Math.max(
    1,
    ...(reportPreview?.monthly.flatMap((item) => [item.fees, item.expenses]) || [1]),
  );

  return (
    <main className="scb-home min-h-screen bg-[#fbfcff] text-slate-900">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[-180px] top-[-180px] h-[500px] w-[500px] rounded-full bg-blue-200/60 blur-3xl" />
        <div className="absolute right-[-180px] top-[120px] h-[460px] w-[460px] rounded-full bg-violet-200/50 blur-3xl" />
        <div className="absolute left-[10%] top-[520px] h-[420px] w-[420px] rounded-full bg-emerald-100/60 blur-3xl" />
        <div className="absolute right-[8%] top-[760px] h-[400px] w-[400px] rounded-full bg-pink-200/50 blur-3xl" />
        <div className="absolute left-[-140px] top-[980px] h-[420px] w-[420px] rounded-full bg-amber-100/60 blur-3xl" />
        <div className="absolute right-[20%] top-[1320px] h-[400px] w-[400px] rounded-full bg-sky-200/50 blur-3xl" />
      </div>

      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="flex items-center gap-3"
            onClick={closeMobileMenu}
          >
            {platformLogo ? (
              <img
                src={platformLogo}
                alt="SCB platform logo"
                className="h-12 w-12 rounded-xl border border-slate-200 bg-white object-contain"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/40">
                <GraduationCap className="h-5 w-5" />
              </div>
            )}

            <div>
              <div className="text-xl font-bold tracking-tight">SCB</div>

              <div className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500 sm:block">
                Smart Campus Board
              </div>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden items-center gap-8 md:flex">
            <a
              href="#features"
              className="text-sm font-medium text-slate-600 transition hover:text-slate-950"
            >
              Features
            </a>

            <a
              href="#solutions"
              className="text-sm font-medium text-slate-600 transition hover:text-slate-950"
            >
              Solutions
            </a>

            <a
              href="#why-scb"
              className="text-sm font-medium text-slate-600 transition hover:text-slate-950"
            >
              Why SCB
            </a>

            <a
              href="#contact"
              className="text-sm font-medium text-slate-600 transition hover:text-slate-950"
            >
              Contact
            </a>
          </nav>

          {/* Desktop Login */}
          <div className="hidden items-center gap-3 md:flex">
            <Link
              href="/login"
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              School Login
            </Link>

            <Link
              href="/super-admin/login"
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
            >
              Sales Team Login
            </Link>

            <Link
              href="/login"
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:-translate-y-0.5"
            >
              Get Started
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
          </div>

          {/* Mobile Menu */}
          <button
            type="button"
            className="rounded-xl p-2 text-slate-700 md:hidden"
            onClick={() => setMobileMenuOpen((value) => !value)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-slate-200 bg-white px-5 py-5 md:hidden">
            <nav className="flex flex-col gap-2">
              <a
                href="#features"
                onClick={closeMobileMenu}
                className="rounded-xl px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Features
              </a>

              <a
                href="#solutions"
                onClick={closeMobileMenu}
                className="rounded-xl px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Solutions
              </a>

              <a
                href="#why-scb"
                onClick={closeMobileMenu}
                className="rounded-xl px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Why SCB
              </a>

              <a
                href="#contact"
                onClick={closeMobileMenu}
                className="rounded-xl px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Contact
              </a>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <Link
                  href="/login"
                  onClick={closeMobileMenu}
                  className="rounded-xl border border-slate-200 px-4 py-3 text-center text-sm font-semibold"
                >
                  School Login
                </Link>

                <Link
                  href="/login"
                  onClick={closeMobileMenu}
                  className="rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-indigo-500/40"
                >
                  Get Started
                </Link>

                <Link
                  href="/super-admin/login"
                  onClick={closeMobileMenu}
                  className="col-span-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-800"
                >
                  Sales Team / Super Admin Login
                </Link>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-6 sm:pt-16 lg:px-8 lg:pb-20 lg:pt-20">
          <div className="grid items-center gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14">
            {/* Hero Text */}
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white px-3.5 py-2 text-xs font-semibold text-indigo-700 shadow-sm">
                <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                One Campus. One Platform. Complete Control.
              </div>

              <h1 className="max-w-4xl text-4xl font-bold tracking-[-0.045em] text-slate-950 sm:text-5xl lg:text-[4.25rem] lg:leading-[1.02]">
                SCB — Smart Campus Board
                <span className="block bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 bg-clip-text text-transparent">
                  Run your entire school from one platform.
                </span>
              </h1>

              <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
                SCB (Smart Campus Board) is the cloud school management platform at
                <span className="text-indigo-600 font-medium">scbcloud.in</span>. It brings
                school administration, students, staff, attendance, fees, payroll, expenses,
                accounting and reports together in one simple platform so you can run your
                entire school from scbcloud.in.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/login"
                  className="group inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-6 py-3.5 text-sm font-semibold text-white shadow-xl shadow-indigo-500/30 transition hover:-translate-y-0.5"
                >
                  Login to SCB
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </Link>

                <a
                  href="#features"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Explore Features
                  <ChevronRight className="h-4 w-4" />
                </a>
              </div>

              <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-slate-500">
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Built for schools
                </span>

                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Cloud based
                </span>

                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Secure access
                </span>
              </div>
            </div>

            {/* Dashboard Preview */}
            <div className="relative">
              <div className="absolute -inset-5 rounded-[2rem] bg-gradient-to-br from-blue-300/30 via-violet-300/25 to-cyan-200/40 blur-2xl" />

              <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_24px_70px_-30px_rgba(39,61,104,0.42)]">
                <div className="flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full bg-rose-300" />
                    <div className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                    <div className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                  </div>

                  <div className="text-xs font-medium text-slate-400">
                    SCB Dashboard
                  </div>

                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-violet-700"><Building2 className="h-3.5 w-3.5" /></div>
                </div>

                <div className="bg-gradient-to-br from-white via-white to-blue-50/50 p-5 sm:p-6">
                  <div className="mb-4 flex items-end justify-between gap-3">
                    <div>
                    <div className="text-[10px] font-bold tracking-[0.14em] text-indigo-500">
                      {reportPreview ? `SCHOOL OVERVIEW · ${reportPreview.schoolName}` : "SCHOOL OVERVIEW"}
                    </div>

                    <div className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
                      Live school snapshot
                    </div>
                    </div>
                    <div className="mb-1 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                      {reportPreviewReady ? (reportPreview ? "Live report" : "Report offline") : "Loading report"}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {previewMetrics.map(({ label, value }, index) => (
                      <div
                        key={label}
                        className={`rounded-2xl border p-3.5 transition duration-300 hover:-translate-y-0.5 hover:shadow-md sm:p-4 ${metricTones[index]}`}
                      >
                        <div className="text-[10px] font-semibold leading-4 opacity-75 sm:text-[11px]">
                          {label}
                        </div>

                        <div className="mt-1.5 text-lg font-extrabold tracking-tight sm:text-xl">
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-bold text-slate-900">
                            Finance overview
                          </div>

                          <div className="mt-1 text-xs text-slate-400">
                            Fees and expenses · last 6 months
                          </div>
                        </div>

                        <BarChart3 className="h-5 w-5 text-indigo-500" />
                      </div>

                      <div className="mt-4 flex h-[112px] items-end justify-between gap-2 border-b border-slate-100 px-1">
                        {(reportPreview?.monthly || []).map((item) => (
                          <div key={item.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                            <div className="flex h-[88px] w-full items-end justify-center gap-1">
                              <div className="w-[40%] rounded-t-md bg-gradient-to-t from-blue-600 to-indigo-400 transition-all duration-700" style={{ height: `${Math.max(4, (item.fees / chartMax) * 88)}px` }} title={`${item.label} fees: ${formatCompactINR(item.fees)}`} />
                              <div className="w-[40%] rounded-t-md bg-gradient-to-t from-fuchsia-500 to-violet-300 transition-all duration-700" style={{ height: `${Math.max(4, (item.expenses / chartMax) * 88)}px` }} title={`${item.label} expenses: ${formatCompactINR(item.expenses)}`} />
                            </div>
                            <span className="text-[9px] font-medium text-slate-400">{item.label}</span>
                          </div>
                        ))}
                        {!reportPreviewReady && <div className="h-20 w-full animate-pulse rounded-xl bg-gradient-to-r from-blue-50 via-violet-50 to-blue-50" />}
                        {reportPreviewReady && !reportPreview && <p className="mb-8 w-full text-center text-xs text-slate-400">Live report preview is temporarily unavailable.</p>}
                      </div>
                      <div className="mt-3 flex items-center gap-4 text-[10px] font-medium text-slate-500"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-blue-600" /> Fees</span><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-fuchsia-500" /> Expenses</span><span className="ml-auto text-slate-400">{reportPreview?.monthLabel || ""}</span></div>
                    </div>

                    <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-4 shadow-sm sm:p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-bold text-slate-900">
                            School at a glance
                          </div>

                          <div className="mt-1 text-xs text-slate-400">
                            {reportPreview?.monthLabel || "Current month"} summary
                          </div>
                        </div>

                        <GraduationCap className="h-5 w-5 text-violet-600" />
                      </div>

                      <div className="mt-7">
                        <div className="text-2xl font-extrabold tracking-tight text-violet-800">
                          {reportPreview ? formatCompactINR(reportPreview.feeCollection) : "—"}
                        </div>

                        <div className="mt-1 text-xs font-medium text-slate-500">
                          Fee collection this month
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-white/90 p-2.5"><div className="text-[10px] text-slate-500">Expenses</div><div className="mt-1 text-sm font-bold text-rose-700">{reportPreview ? formatCompactINR(reportPreview.expenses) : "—"}</div></div>
                        <div className="rounded-xl bg-white/90 p-2.5"><div className="text-[10px] text-slate-500">Classes</div><div className="mt-1 text-sm font-bold text-blue-700">{reportPreview ? reportPreview.classes.toLocaleString("en-IN") : "—"}</div></div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between rounded-2xl bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-900 px-5 py-3.5 text-white shadow-lg shadow-indigo-950/10">
                    <div>
                      <div className="text-sm font-semibold">
                        Everything connected
                      </div>

                      <div className="mt-1 text-xs text-slate-400">
                        One platform for your school
                      </div>
                    </div>

                    <ShieldCheck className="h-6 w-6 text-emerald-300" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-slate-200 bg-slate-50/70">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-slate-200 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="px-5 py-8 text-center sm:py-10">
              <div className="text-3xl font-bold tracking-tight text-slate-950">
                {stat.value}
              </div>

              <div className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-24">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              Everything connected
            </div>

            <h2 className="mt-4 text-4xl font-bold tracking-[-0.03em] text-slate-950 sm:text-5xl">
              One platform for every part of your school
            </h2>

            <p className="mt-5 text-lg leading-8 text-slate-600">
              SCB brings the important school workflows together in one
              connected system.
            </p>
          </div>

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature, index) => {
              const Icon = feature.icon;

              return (
                <div
                  key={feature.title}
                  className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-900/10"
                >
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${featureTones[index]} transition duration-300 group-hover:text-white group-hover:shadow-lg`}>
                    <Icon className="h-5 w-5" />
                  </div>

                  <h3 className="mt-5 text-lg font-bold text-slate-950">
                    {feature.title}
                  </h3>

                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Solutions */}
      <section
        id="solutions"
        className="scroll-mt-24 border-y border-slate-200 bg-slate-950 text-white"
      >
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="grid gap-14 lg:grid-cols-2 lg:items-center">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
                Built around your school
              </div>

              <h2 className="mt-4 text-4xl font-bold tracking-[-0.03em] sm:text-5xl">
                From daily attendance to complete accounting.
              </h2>

              <p className="mt-6 max-w-xl text-lg leading-8 text-slate-400">
                SCB connects operational and financial workflows so your
                school team can spend less time managing data and more time
                managing the school.
              </p>

              <div className="mt-8">
                <Link
                  href="/login"
                  className="group inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
                >
                  Enter SCB
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </Link>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {[
                {
                  icon: Building2,
                  title: "Administration",
                  text: "Keep school operations organized in one central system.",
                },
                {
                  icon: ClipboardCheck,
                  title: "Attendance",
                  text: "Track attendance, working hours, holidays and reports.",
                },
                {
                  icon: IndianRupee,
                  title: "Finance",
                  text: "Connect fees, expenses, payments and accounting.",
                },
                {
                  icon: FileText,
                  title: "Payroll & Reports",
                  text: "Process salaries and generate useful school reports.",
                },
              ].map((item) => {
                const Icon = item.icon;

                return (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] p-6"
                  >
                    <Icon className="h-6 w-6 text-slate-300" />

                    <h3 className="mt-5 font-semibold">{item.title}</h3>

                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      {item.text}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Why SCB */}
      <section id="why-scb" className="scroll-mt-24">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="grid gap-14 lg:grid-cols-2 lg:items-center">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                Why SCB
              </div>

              <h2 className="mt-4 text-4xl font-bold tracking-[-0.03em] text-slate-950 sm:text-5xl">
                Designed to make school management simpler.
              </h2>

              <p className="mt-6 text-lg leading-8 text-slate-600">
                Your school should not need a collection of disconnected
                tools. SCB gives administrators a single place to manage
                everyday operations and financial workflows.
              </p>
            </div>

            <div className="space-y-4">
              {[
                "Centralized school management",
                "Role-based access for school teams",
                "Attendance and payroll connected",
                "Fees, expenses and accounting connected",
                "Useful reports for daily decisions",
                "Cloud-based access from anywhere",
              ].map((item, index) => (
                <div
                  key={item}
                  className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 text-sm font-bold text-white shadow-md shadow-indigo-500/30">
                    {index + 1}
                  </div>

                  <span className="font-semibold text-slate-800">{item}</span>

                  <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-emerald-600" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Contact / CTA */}
      <section id="contact" className="scroll-mt-24 px-5 pb-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-3xl bg-slate-100">
          <div className="relative px-6 py-16 text-center sm:px-10 lg:px-20 lg:py-20">
            <div className="absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-white blur-3xl" />

            <div className="relative">
              {platformLogo ? (
                <img
                  src={platformLogo}
                  alt="SCB platform logo"
                  className="mx-auto h-16 w-16 rounded-2xl border border-slate-200 bg-white object-contain"
                />
              ) : (
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/40">
                  <GraduationCap className="h-6 w-6" />
                </div>
              )}

              <h2 className="mt-6 text-4xl font-bold tracking-[-0.03em] text-slate-950 sm:text-5xl">
                Ready to manage your school smarter?
              </h2>

              <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-600">
                Bring your school's administration, attendance, finance,
                payroll and accounting together with SCB.
              </p>

              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Link
                  href="/login"
                  className="group inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-7 py-3.5 text-sm font-semibold text-white shadow-xl shadow-indigo-500/40 transition hover:-translate-y-0.5 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700"
                >
                  Login to SCB
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </Link>

                <a
                  href="tel:7780670760"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-7 py-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Call 7780670760
                </a>
              </div>

              <div className="mt-8 flex flex-col items-center justify-center gap-3 text-sm text-slate-600 sm:flex-row sm:gap-8">
                <a
                  href="tel:7780670760"
                  className="font-semibold transition hover:text-slate-950"
                >
                   7780670760
                </a>

                <a
                  href="mailto:scbcloud.in@gmail.com"
                  className="font-semibold transition hover:text-slate-950"
                >
                   scbcloud.in@gmail.com
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* About SCB */}
      <section className="border-y border-slate-200 bg-slate-50/70 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 lg:items-center lg:gap-12">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
                What is SCB — Smart Campus Board?
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                SCB (Smart Campus Board) is a complete cloud-based school
                management platform built for Indian schools. It is accessible at
                <a
                  href="https://scbcloud.in"
                  className="text-indigo-600 hover:underline font-medium"
                >
                  scbcloud.in
                </a>
                . SCB helps school owners, principals, teachers and staff manage
                admissions, students, classes, attendance, fees, expenses,
                payroll and accounting from a single dashboard.
              </p>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                Whether you search for SCB, Smart Campus Board or scbcloud.in,
                our platform gives every school the tools to run operations
                online, collect fees digitally, track staff attendance and
                generate real-time reports — all from the cloud.
              </p>
            </div>
            <div className="mt-12 lg:mt-0 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <h3 className="text-xl font-bold text-slate-950">Key capabilities</h3>
              <ul className="mt-4 space-y-3 text-slate-600">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  Student admission &amp; records
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  Staff &amp; payroll management
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  Fee collection &amp; accounting
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  Daily attendance &amp; reports
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-3">
                {platformLogo ? (
                  <img
                    src={platformLogo}
                    alt="SCB platform logo"
                    className="h-14 w-14 rounded-xl border border-slate-200 bg-white object-contain"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 text-white">
                    <GraduationCap className="h-5 w-5" />
                  </div>
                )}

                <span className="text-lg font-bold">SCB</span>
              </div>

              <p className="mt-3 max-w-md text-sm text-slate-500">
                The complete operating platform for modern schools.
              </p>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
              <a
                href="#features"
                className="text-slate-500 transition hover:text-slate-950"
              >
                Features
              </a>

              <a
                href="#solutions"
                className="text-slate-500 transition hover:text-slate-950"
              >
                Solutions
              </a>

              <a
                href="#contact"
                className="text-slate-500 transition hover:text-slate-950"
              >
                Contact
              </a>

              <Link
                href="/privacy-policy"
                className="text-slate-500 transition hover:text-slate-950"
              >
                Privacy Policy
              </Link>

              <Link
                href="/terms-and-conditions"
                className="text-slate-500 transition hover:text-slate-950"
              >
                Terms &amp; Conditions
              </Link>

              <Link
                href="/login"
                className="font-semibold text-slate-900 transition hover:text-slate-600"
              >
                Login
              </Link>

              <Link
                href="/super-admin/login"
                className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 hover:-translate-y-0.5"
              >
                Sales Team / Super Admin Login
              </Link>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-2 border-t border-slate-100 pt-6 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          </div>
        </div>
      </footer>
    </main>
  );
}





