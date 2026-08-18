import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { lookupProductByBarcode } from "@/lib/inventory/barcodeService";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ barcode: string }> }
) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.PRODUCT_VIEW)) {
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
