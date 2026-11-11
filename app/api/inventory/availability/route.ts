import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getAvailableStock } from "@/lib/reservations/reservationService";

async function scopedGET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.STOCK_VIEW) && !hasPermission(user, BuildStockPermissions.RESERVATION_VIEW)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to view inventory availability" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("productId");
    const warehouseId = searchParams.get("warehouseId");

    if (!productId || !warehouseId) {
      return NextResponse.json({ error: "Both productId and warehouseId are required query parameters" }, { status: 400 });
    }

    const availability = await getAvailableStock(productId, warehouseId);
    return NextResponse.json(availability);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to calculate stock availability" }, { status: 500 });
  }
}

export const GET = withWarehouseScope(scopedGET);
