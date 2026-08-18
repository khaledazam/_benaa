import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getCustomerSalesStats } from "@/lib/customers/customerService";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.CUSTOMER_VIEW)) {
      return NextResponse.json({ error: "Unauthorized access" }, { status: 403 });
    }

    const { id } = await context.params;
    const stats = await getCustomerSalesStats(id);
    return NextResponse.json(stats);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch customer sales statistics" }, { status: 404 });
  }
}
