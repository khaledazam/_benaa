import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getAdjustments, createAdjustment } from "@/lib/inventory/adjustmentService";
import { createAdjustmentSchema } from "@/lib/validations/adjustment-validations";

async function scopedGET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.INVENTORY_ADJUSTMENT_VIEW)) {
      return NextResponse.json({ error: "Forbidden — INVENTORY_ADJUSTMENT_VIEW permission required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouseId") || undefined;
    const status = searchParams.get("status") || undefined;
    const adjustmentType = searchParams.get("adjustmentType") || undefined;
    const search = searchParams.get("search") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const result = await getAdjustments({ warehouseId, status, adjustmentType, search, page, limit });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch adjustments" }, { status: 500 });
  }
}

async function scopedPOST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = user.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.INVENTORY_ADJUSTMENT_CREATE)) {
      return NextResponse.json({ error: "Forbidden — INVENTORY_ADJUSTMENT_CREATE permission required" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = createAdjustmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error", details: parsed.error.format() }, { status: 400 });
    }

    const adjustment = await createAdjustment(parsed.data, user.id);
    return NextResponse.json(adjustment, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to create adjustment" }, { status: 400 });
  }
}

export const GET = withWarehouseScope(scopedGET);
export const POST = withWarehouseScope(scopedPOST);
