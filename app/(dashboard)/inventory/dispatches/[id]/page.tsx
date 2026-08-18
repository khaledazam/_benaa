import { DispatchDetailView } from "@/components/dispatch/DispatchDetailView";

export const metadata = {
  title: "Dispatch Detail | BuildStock WMS",
  description: "View dispatch details and physical stock deduction ledger",
};

export default async function DispatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DispatchDetailView dispatchId={id} />;
}
