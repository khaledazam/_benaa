import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/requireRole";
import { getWarehouseLocationTree } from "@/lib/locations/locationService";
import { BuildStockPermissions } from "@/lib/auth/permissions";

async function scopedGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request, BuildStockPermissions.LOCATION_VIEW);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const tree = await getWarehouseLocationTree(id);
    return NextResponse.json(tree);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
export const GET = withWarehouseScope(scopedGET);
