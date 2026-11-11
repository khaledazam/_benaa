import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { cancelAdjustment } from "@/lib/inventory/adjustmentService";
import { cancelAdjustmentSchema } from "@/lib/validations/adjustment-validations";

async function scopedPOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = user.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.INVENTORY_ADJUSTMENT_CANCEL)) {
      return NextResponse.json({ error: "Forbidden — INVENTORY_ADJUSTMENT_CANCEL permission required" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const parsed = cancelAdjustmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error", details: parsed.error.format() }, { status: 400 });
    }

    const cancelled = await cancelAdjustment(id, parsed.data.reason, user.id);
    return NextResponse.json(cancelled);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to cancel adjustment" }, { status: 400 });
  }
}

export const POST = withWarehouseScope(scopedPOST);
