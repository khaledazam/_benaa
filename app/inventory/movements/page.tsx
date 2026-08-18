import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import StockMovementsView from "@/components/inventory/StockMovementsView";

export const dynamic = "force-dynamic";

export default async function StockMovementsPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <StockMovementsView />;
}
