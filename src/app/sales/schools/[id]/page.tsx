import { SalesSchoolDetail } from "@/components/business/sales-schools";

export default async function SalesSchoolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SalesSchoolDetail schoolId={id} />;
}
