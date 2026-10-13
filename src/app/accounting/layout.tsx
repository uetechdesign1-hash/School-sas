import { Suspense, type ReactNode } from "react";
import { AccountingAcademicYearProvider } from "@/components/accounting/academic-year-provider";

export default function AccountingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="px-6 py-5 text-sm text-slate-500">
          Loading accounting workspace…
        </div>
      }
    >
      <AccountingAcademicYearProvider>
        {children}
      </AccountingAcademicYearProvider>
    </Suspense>
  );
}
