import { SalesRepDetail } from "@/components/business/sales-rep-detail";

export default async function SuperAdminSalesRepPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SalesRepDetail repId={id} />;
}
