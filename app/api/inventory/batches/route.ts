import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getInventoryBatches } from "@/lib/inventory/batchService";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.STOCK_VIEW)) {
      return NextResponse.json({ error: "Forbidden — STOCK_VIEW permission required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouseId") || undefined;
    const productId = searchParams.get("productId") || undefined;
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const result = await getInventoryBatches({ warehouseId, productId, status, search, page, limit });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch batches" }, { status: 500 });
  }
}
