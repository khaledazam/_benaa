import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { submitSalesOrder } from "@/lib/sales/salesOrderService";

async function scopedPOST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.SALES_ORDER_SUBMIT)) {
      return NextResponse.json({ error: "Insufficient permissions to submit sales orders" }, { status: 403 });
    }

    const { id } = await context.params;
    const updated = await submitSalesOrder(id, user?.id || "system");
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to submit sales order" }, { status: 400 });
  }
}

export const POST = withWarehouseScope(scopedPOST);
