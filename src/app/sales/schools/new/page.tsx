import { Suspense } from "react";
import { SchoolWizard } from "@/components/business/school-wizard";
import { LoadingBlock } from "@/components/business/ui";

export default function SalesNewSchoolPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <SchoolWizard basePath="/sales" isAdmin={false} />
    </Suspense>
  );
}
