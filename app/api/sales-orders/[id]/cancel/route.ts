import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { cancelSalesOrder } from "@/lib/sales/salesOrderService";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.SALES_ORDER_CANCEL)) {
      return NextResponse.json({ error: "Insufficient permissions to cancel sales orders" }, { status: 403 });
    }

    const { id } = await context.params;
    let reason: string | undefined = undefined;

    try {
      const body = await req.json();
      reason = body.reason;
    } catch {
      // Body may be empty
    }

    const updated = await cancelSalesOrder(id, reason, user?.id || "system");
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to cancel sales order" }, { status: 400 });
  }
}
