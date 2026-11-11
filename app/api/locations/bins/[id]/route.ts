import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { deactivateBin } from "@/lib/locations/locationService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

async function scopedDELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request, BuildStockPermissions.LOCATION_DEACTIVATE);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const deactivated = await deactivateBin(id);
    return NextResponse.json(deactivated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
export const DELETE = withWarehouseScope(scopedDELETE);
