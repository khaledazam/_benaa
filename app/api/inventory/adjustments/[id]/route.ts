import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getAdjustmentById } from "@/lib/inventory/adjustmentService";

async function scopedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.INVENTORY_ADJUSTMENT_VIEW)) {
      return NextResponse.json({ error: "Forbidden — INVENTORY_ADJUSTMENT_VIEW permission required" }, { status: 403 });
    }

    const { id } = await params;
    const adjustment = await getAdjustmentById(id);
    if (!adjustment) {
      return NextResponse.json({ error: "Stock adjustment not found" }, { status: 404 });
    }

    return NextResponse.json(adjustment);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch adjustment" }, { status: 500 });
  }
}

export const GET = withWarehouseScope(scopedGET);
