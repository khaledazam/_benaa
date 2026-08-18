import { AdjustmentDetailView } from "@/components/inventory/AdjustmentDetailView";

export default async function AdjustmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdjustmentDetailView adjustmentId={id} />;
}
