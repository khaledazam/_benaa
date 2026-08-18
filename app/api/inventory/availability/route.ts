import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getAvailableStock } from "@/lib/reservations/reservationService";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.STOCK_VIEW) && !hasPermission(role, BuildStockPermissions.RESERVATION_VIEW)) {
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
