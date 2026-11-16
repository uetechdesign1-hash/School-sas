import { Suspense } from "react";
import { SchoolWizard } from "@/components/business/school-wizard";
import { LoadingBlock } from "@/components/business/ui";

export default function SuperAdminNewSchoolPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <SchoolWizard basePath="/super-admin" isAdmin />
    </Suspense>
  );
}
