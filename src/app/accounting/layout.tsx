import { Suspense, type ReactNode } from "react";
import { AccountingAcademicYearProvider } from "@/components/accounting/academic-year-provider";
import { ModuleGuard, SchoolProvider } from "@/lib/school-context";

export default function AccountingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <SchoolProvider>
      <ModuleGuard>
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
      </ModuleGuard>
    </SchoolProvider>
  );
}
