import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { lookupProductByBarcode } from "@/lib/inventory/barcodeService";
import { withWarehouseScope } from '@/lib/auth/warehouse-route-scope';

async function scopedGET(
  req: NextRequest,
  { params }: { params: Promise<{ barcode: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.PRODUCT_VIEW) || !hasPermission(user, BuildStockPermissions.STOCK_VIEW)) {
      return NextResponse.json({ error: "Forbidden — PRODUCT_VIEW permission required" }, { status: 403 });
    }

    const { barcode } = await params;
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouseId") || undefined;

    const result = await lookupProductByBarcode(decodeURIComponent(barcode), warehouseId);
    if (!result) {
      return NextResponse.json({ error: `No product found matching barcode or SKU '${barcode}'` }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Barcode lookup failed" }, { status: 500 });
  }
}
export const GET = withWarehouseScope(scopedGET);
