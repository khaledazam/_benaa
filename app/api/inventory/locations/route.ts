import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { getLocationInventory } from "@/lib/locations/locationService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, BuildStockPermissions.STOCK_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const warehouseId = searchParams.get("warehouseId") || undefined;
    const zoneId = searchParams.get("zoneId") || undefined;
    const rackId = searchParams.get("rackId") || undefined;
    const shelfId = searchParams.get("shelfId") || undefined;
    const binId = searchParams.get("binId") || undefined;
    const productId = searchParams.get("productId") || undefined;

    const inventory = await getLocationInventory({
      warehouseId,
      zoneId,
      rackId,
      shelfId,
      binId,
      productId,
    });

    return NextResponse.json(inventory);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
