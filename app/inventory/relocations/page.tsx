import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import StockRelocationView from "@/components/inventory/StockRelocationView";

export const dynamic = "force-dynamic";

export default async function StockRelocationPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <StockRelocationView />;
}
