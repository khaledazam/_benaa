import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import InventoryView from "@/components/inventory/InventoryView";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <InventoryView />;
}
