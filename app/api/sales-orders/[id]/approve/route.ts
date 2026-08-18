import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { approveSalesOrder } from "@/lib/sales/salesOrderService";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.SALES_ORDER_APPROVE)) {
      return NextResponse.json({ error: "Insufficient permissions to approve sales orders" }, { status: 403 });
    }

    const { id } = await context.params;
    const updated = await approveSalesOrder(id, user?.id || "system");
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to approve sales order" }, { status: 400 });
  }
}
