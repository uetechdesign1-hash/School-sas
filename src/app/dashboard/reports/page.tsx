/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  BarChart3,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  FileBarChart,
  FileSpreadsheet,
  GraduationCap,
  Landmark,
  Receipt,
  Users,
  WalletCards,
} from "lucide-react";

type ReportCard = {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
};

const reportGroups: {
  title: string;
  description: string;
  cards: ReportCard[];
}[] = [
  {
    title: "School Management",
    description: "Operational reports for fees, attendance, staff and expenses.",
    cards: [
      {
        title: "Fee Collection",
        description: "Review collected fees and payment activity.",
        href: "/dashboard/fees",
        icon: <GraduationCap size={21} />,
      },
      {
        title: "Staff Attendance",
        description: "Monthly attendance, daily status and working hours.",
        href: "/dashboard/attendance",
        icon: <CalendarCheck size={21} />,
      },
      {
        title: "Staff Payroll",
        description: "Review payroll preparation and salary information.",
        href: "/dashboard/payroll",
        icon: <Users size={21} />,
      },
      {
        title: "Expenses",
        description: "Monthly expenses, categories, vendors and payment accounts.",
        href: "/dashboard/expenses",
        icon: <Receipt size={21} />,
      },
    ],
  },
  {
    title: "Accounting Reports",
    description: "Use the existing accounting modules for financial reporting.",
    cards: [
      {
        title: "Cash Book",
        description: "View cash receipts, payments and running balance.",
        href: "/accounting/cash-book",
        icon: <Banknote size={21} />,
      },
      {
        title: "Bank Book",
        description: "View bank transactions and running balance.",
        href: "/accounting/bank-book",
        icon: <Landmark size={21} />,
      },
      {
        title: "Ledger",
        description: "Review account-wise debit and credit entries.",
        href: "/accounting/ledger",
        icon: <BookOpen size={21} />,
      },
      {
        title: "Trial Balance",
        description: "Check debit and credit balances for the school.",
        href: "/accounting/trial-balance",
        icon: <FileBarChart size={21} />,
      },
      {
        title: "Profit & Loss",
        description: "Review income, expenses and net result.",
        href: "/accounting/profit-loss",
        icon: <BarChart3 size={21} />,
      },
      {
        title: "Balance Sheet",
        description: "Review assets, liabilities and equity.",
        href: "/accounting/balance-sheet",
        icon: <FileSpreadsheet size={21} />,
      },
      {
        title: "Bank Reconciliation",
        description: "Compare bank records with accounting transactions.",
        href: "/accounting/bank-reconciliation",
        icon: <CheckCircle2 size={21} />,
      },
      {
        title: "Journal",
        description: "Review accounting journal transactions.",
        href: "/accounting/journal",
        icon: <ClipboardList size={21} />,
      },
    ],
  },
  {
    title: "Transactions",
    description: "Open the existing accounting transaction modules directly.",
    cards: [
      {
        title: "Receipts",
        description: "Open the existing receipt transaction module.",
        href: "/accounting/receipt",
        icon: <Receipt size={21} />,
      },
      {
        title: "Payments",
        description: "Open the existing payment transaction module.",
        href: "/accounting/payment",
        icon: <WalletCards size={21} />,
      },
      {
        title: "Contra",
        description: "Open the existing cash/bank transfer module.",
        href: "/accounting/contra",
        icon: <Landmark size={21} />,
      },
    ],
  },
];

export default function ReportsPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-6 py-7">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
              <BarChart3 size={24} />
            </div>
            <div>
              <div className="text-sm font-semibold text-blue-600">
                School Management
              </div>
              <h1 className="mt-1 text-3xl font-bold text-slate-900">
                Reports
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Access school management and accounting reports from one place.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-7">
        {reportGroups.map((group) => (
          <section key={group.title} className="mb-7">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-slate-900">
                {group.title}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {group.description}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.cards.map((card) => (
                <Link
                  key={card.href}
                  href={card.href}
                  className="group rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      {card.icon}
                    </div>
                    <ArrowRight
                      size={18}
                      className="mt-1 text-slate-300 transition group-hover:translate-x-1 group-hover:text-blue-600"
                    />
                  </div>

                  <h3 className="mt-4 font-bold text-slate-900">
                    {card.title}
                  </h3>

                  <p className="mt-1.5 text-sm leading-6 text-slate-500">
                    {card.description}
                  </p>

                  <div className="mt-4 text-xs font-bold text-blue-600">
                    Open report →
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}

        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
          <div className="flex items-start gap-3">
            <BarChart3 className="mt-0.5 text-blue-600" size={20} />
            <div>
              <h3 className="font-bold text-blue-900">
                Reports use your existing modules
              </h3>
              <p className="mt-1 text-sm leading-6 text-blue-800">
                These cards are navigation only. They do not create duplicate
                accounting systems or change the existing accounting pages.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
