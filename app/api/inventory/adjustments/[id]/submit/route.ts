import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { submitAdjustment } from "@/lib/inventory/adjustmentService";

async function scopedPOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = user.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.INVENTORY_ADJUSTMENT_SUBMIT)) {
      return NextResponse.json({ error: "Forbidden — INVENTORY_ADJUSTMENT_SUBMIT permission required" }, { status: 403 });
    }

    const { id } = await params;
    const adjustment = await submitAdjustment(id, user.id);
    return NextResponse.json(adjustment);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to submit adjustment" }, { status: 400 });
  }
}

export const POST = withWarehouseScope(scopedPOST);
