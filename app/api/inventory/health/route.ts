import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getInventoryHealthReport } from "@/lib/inventory/healthService";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.STOCK_VIEW)) {
      return NextResponse.json({ error: "Forbidden — STOCK_VIEW permission required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouseId") || undefined;

    const report = await getInventoryHealthReport(warehouseId);
    return NextResponse.json(report);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch inventory health report" }, { status: 500 });
  }
}
