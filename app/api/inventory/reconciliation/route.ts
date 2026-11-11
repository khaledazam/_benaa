import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { runFullInventoryReconciliation } from "@/lib/inventory/reconciliationService";

async function scopedGET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.INVENTORY_RECONCILIATION_VIEW)) {
      return NextResponse.json(
        { error: "Forbidden: Insufficient permissions to view inventory reconciliation" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouseId") || undefined;
    const productId = searchParams.get("productId") || undefined;
    const status = (searchParams.get("status") as any) || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const data = await runFullInventoryReconciliation({
      warehouseId,
      productId,
      status,
      page,
      limit,
    });

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("GET /api/inventory/reconciliation error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch inventory reconciliation report" },
      { status: error.status || 500 }
    );
  }
}

export const GET = withWarehouseScope(scopedGET);
