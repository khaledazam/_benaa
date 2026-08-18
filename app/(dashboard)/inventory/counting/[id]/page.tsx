import { CountDetailView } from "@/components/inventory/CountDetailView";

export default async function CountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CountDetailView countId={id} />;
}
