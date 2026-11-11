import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getBatchSuggestions } from "@/lib/inventory/batchService";

async function scopedGET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.STOCK_VIEW)) {
      return NextResponse.json({ error: "Forbidden — STOCK_VIEW permission required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("productId");
    const warehouseId = searchParams.get("warehouseId");
    const quantity = parseFloat(searchParams.get("quantity") || "1");

    if (!productId || !warehouseId) {
      return NextResponse.json({ error: "Missing required parameters: productId and warehouseId" }, { status: 400 });
    }

    const suggestions = await getBatchSuggestions({
      productId,
      warehouseId,
      requiredQuantity: quantity,
    });

    return NextResponse.json({ suggestions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch batch suggestions" }, { status: 500 });
  }
}

export const GET = withWarehouseScope(scopedGET);
