import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import { getClientPortalForAdmin } from "@/lib/server/client-portal-data";
import AdminClientPortalContent from "@/components/admin/AdminClientPortalContent";

/** REQ-0025 — blocking SSR prefetch (no Suspense shell flash). */
export const dynamic = "force-dynamic";

export default async function AdminClientPortalPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  const role = user.role?.toUpperCase() || "";
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN" || role === "SUPERADMIN";
  if (!isAdmin) redirect("/admin");

  const initialStats = await getClientPortalForAdmin();
  return <AdminClientPortalContent initialStats={initialStats} />;
}
