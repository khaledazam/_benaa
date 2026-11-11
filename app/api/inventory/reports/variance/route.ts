import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getInventoryVarianceReport, getAdjustmentHistoryReport, getDamageAndLossReport } from "@/lib/inventory/reportingService";

async function scopedGET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.REPORT_VIEW)) {
      return NextResponse.json({ error: "Forbidden — REPORT_VIEW permission required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "variance";
    const warehouseId = searchParams.get("warehouseId") || undefined;
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    if (type === "history") {
      const adjustmentType = searchParams.get("adjustmentType") || undefined;
      const history = await getAdjustmentHistoryReport({ warehouseId, adjustmentType, startDate, endDate, page, limit });
      return NextResponse.json(history);
    }

    if (type === "damage") {
      const damage = await getDamageAndLossReport({ warehouseId, startDate, endDate });
      return NextResponse.json(damage);
    }

    const variance = await getInventoryVarianceReport({ warehouseId, startDate, endDate, page, limit });
    return NextResponse.json(variance);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch variance report" }, { status: 500 });
  }
}

export const GET = withWarehouseScope(scopedGET);
