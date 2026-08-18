import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getPickingAvailability } from "@/lib/picking/pickingService";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.PICK_LIST_VIEW)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to view picking availability" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("productId");
    const warehouseId = searchParams.get("warehouseId");
    const excludePickListId = searchParams.get("excludePickListId") || undefined;

    if (!productId || !warehouseId) {
      return NextResponse.json(
        { error: "productId and warehouseId are required query parameters" },
        { status: 400 }
      );
    }

    const availabilities = await getPickingAvailability(productId, warehouseId, excludePickListId);

    return NextResponse.json({ availabilities });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch picking availability" }, { status: 500 });
  }
}
