import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import PurchaseOrdersView from "@/components/procurement/PurchaseOrdersView";

export const dynamic = "force-dynamic";

export default async function PurchasingPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <PurchaseOrdersView />;
}
