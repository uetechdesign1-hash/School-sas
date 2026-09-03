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
import { useState } from "react";

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

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[-180px] top-[-180px] h-[500px] w-[500px] rounded-full bg-blue-100/50 blur-3xl" />
        <div className="absolute right-[-180px] top-[250px] h-[500px] w-[500px] rounded-full bg-indigo-100/40 blur-3xl" />
      </div>

      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="flex items-center gap-3"
            onClick={closeMobileMenu}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white shadow-lg shadow-slate-900/20">
              <GraduationCap className="h-5 w-5" />
            </div>

            <div>
              <div className="text-xl font-bold tracking-tight">EduNexa</div>

              <div className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500 sm:block">
                School Management
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
              href="#why-edunexa"
              className="text-sm font-medium text-slate-600 transition hover:text-slate-950"
            >
              Why EduNexa
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
              Login
            </Link>

            <Link
              href="/login"
              className="group inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5 hover:bg-slate-800"
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
                href="#why-edunexa"
                onClick={closeMobileMenu}
                className="rounded-xl px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Why EduNexa
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
                  Login
                </Link>

                <Link
                  href="/login"
                  onClick={closeMobileMenu}
                  className="rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-semibold text-white"
                >
                  Get Started
                </Link>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-5 pb-20 pt-16 sm:px-6 sm:pt-20 lg:px-8 lg:pb-28 lg:pt-28">
          <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
            {/* Hero Text */}
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm">
                <Sparkles className="h-3.5 w-3.5" />
                Complete School Management Platform
              </div>

              <h1 className="max-w-4xl text-5xl font-bold tracking-[-0.04em] text-slate-950 sm:text-6xl lg:text-7xl">
                Run your entire school
                <span className="block text-slate-500">
                  from one platform.
                </span>
              </h1>

              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
                EduNexa brings school administration, students, staff,
                attendance, fees, payroll, expenses, accounting and reports
                together in one simple platform.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/login"
                  className="group inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-6 py-3.5 text-sm font-semibold text-white shadow-xl shadow-slate-900/20 transition hover:-translate-y-0.5 hover:bg-slate-800"
                >
                  Login to EduNexa
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
              <div className="absolute -inset-5 rounded-[2rem] bg-slate-200/50 blur-2xl" />

              <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                    <div className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                    <div className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                  </div>

                  <div className="text-xs font-medium text-slate-400">
                    EduNexa Dashboard
                  </div>

                  <div className="h-7 w-7 rounded-full bg-slate-100" />
                </div>

                <div className="p-5 sm:p-7">
                  <div className="mb-6">
                    <div className="text-xs font-medium text-slate-400">
                      SCHOOL OVERVIEW
                    </div>

                    <div className="mt-1 text-2xl font-bold text-slate-950">
                      Good morning ðŸ‘‹
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ["Students", "1,248"],
                      ["Staff", "86"],
                      ["Attendance", "94.8%"],
                      ["Fees", "â‚¹12.4L"],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="text-[11px] font-medium text-slate-500">
                          {label}
                        </div>

                        <div className="mt-2 text-lg font-bold text-slate-950">
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-2xl border border-slate-200 p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            Attendance Overview
                          </div>

                          <div className="mt-1 text-xs text-slate-400">
                            This month
                          </div>
                        </div>

                        <ClipboardCheck className="h-5 w-5 text-slate-400" />
                      </div>

                      <div className="mt-7 flex items-end gap-2">
                        {[
                          55, 72, 61, 84, 78, 91, 68, 87, 76, 94, 82, 89,
                        ].map((height, index) => (
                          <div
                            key={index}
                            className="flex-1 rounded-t-md bg-slate-900/10"
                            style={{ height: `${height}px` }}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            Finance
                          </div>

                          <div className="mt-1 text-xs text-slate-400">
                            Monthly summary
                          </div>
                        </div>

                        <IndianRupee className="h-5 w-5 text-slate-400" />
                      </div>

                      <div className="mt-7">
                        <div className="text-2xl font-bold text-slate-950">
                          â‚¹18.6L
                        </div>

                        <div className="mt-2 text-xs text-emerald-600">
                          +12.4% this month
                        </div>
                      </div>

                      <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full w-[76%] rounded-full bg-slate-900" />
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-950 px-5 py-4 text-white">
                    <div>
                      <div className="text-sm font-semibold">
                        Everything connected
                      </div>

                      <div className="mt-1 text-xs text-slate-400">
                        One platform for your school
                      </div>
                    </div>

                    <ShieldCheck className="h-6 w-6 text-slate-300" />
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
              EduNexa brings the important school workflows together in one
              connected system.
            </p>
          </div>

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => {
              const Icon = feature.icon;

              return (
                <div
                  key={feature.title}
                  className="group rounded-2xl border border-slate-200 bg-white p-6 transition duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-xl hover:shadow-slate-900/5"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-900 transition group-hover:bg-slate-950 group-hover:text-white">
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
                EduNexa connects operational and financial workflows so your
                school team can spend less time managing data and more time
                managing the school.
              </p>

              <div className="mt-8">
                <Link
                  href="/login"
                  className="group inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
                >
                  Enter EduNexa
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

      {/* Why EduNexa */}
      <section id="why-edunexa" className="scroll-mt-24">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="grid gap-14 lg:grid-cols-2 lg:items-center">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                Why EduNexa
              </div>

              <h2 className="mt-4 text-4xl font-bold tracking-[-0.03em] text-slate-950 sm:text-5xl">
                Designed to make school management simpler.
              </h2>

              <p className="mt-6 text-lg leading-8 text-slate-600">
                Your school should not need a collection of disconnected
                tools. EduNexa gives administrators a single place to manage
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
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-bold text-white">
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
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <GraduationCap className="h-6 w-6" />
              </div>

              <h2 className="mt-6 text-4xl font-bold tracking-[-0.03em] text-slate-950 sm:text-5xl">
                Ready to manage your school smarter?
              </h2>

              <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-600">
                Bring your school's administration, attendance, finance,
                payroll and accounting together with EduNexa.
              </p>

              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Link
                  href="/login"
                  className="group inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-7 py-3.5 text-sm font-semibold text-white shadow-xl shadow-slate-900/20 transition hover:-translate-y-0.5 hover:bg-slate-800"
                >
                  Login to EduNexa
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
                  href="mailto:edunexa17@gmail.com"
                  className="font-semibold transition hover:text-slate-950"
                >
                   edunexa17@gmail.com
                </a>
              </div>
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
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white">
                  <GraduationCap className="h-5 w-5" />
                </div>

                <span className="text-lg font-bold">EduNexa</span>
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
                href="/login"
                className="font-semibold text-slate-900 transition hover:text-slate-600"
              >
                Login
              </Link>

              <Link
                href="/super-admin/login"
                className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 hover:-translate-y-0.5"
              >
                Super Admin Login
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





