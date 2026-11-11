import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getSalesOrderById, updateSalesOrderDraft } from "@/lib/sales/salesOrderService";

async function scopedGET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.SALES_ORDER_VIEW)) {
      return NextResponse.json({ error: "Unauthorized access" }, { status: 403 });
    }

    const { id } = await context.params;
    const order = await getSalesOrderById(id);
    return NextResponse.json(order);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Sales order not found" }, { status: 404 });
  }
}

async function scopedPATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.SALES_ORDER_UPDATE)) {
      return NextResponse.json({ error: "Insufficient permissions to update sales orders" }, { status: 403 });
    }

    const { id } = await context.params;
    const body = await req.json();
    const updated = await updateSalesOrderDraft(id, body, user?.id || "system");
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update sales order" }, { status: 400 });
  }
}

export const GET = withWarehouseScope(scopedGET);
export const PATCH = withWarehouseScope(scopedPATCH);
