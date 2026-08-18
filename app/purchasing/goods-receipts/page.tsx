import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import GoodsReceiptsView from "@/components/procurement/GoodsReceiptsView";

export const dynamic = "force-dynamic";

export default async function GoodsReceiptsPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return <GoodsReceiptsView />;
}
