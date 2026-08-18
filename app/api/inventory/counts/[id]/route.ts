import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getInventoryCountById } from "@/lib/inventory/countingService";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(role, BuildStockPermissions.INVENTORY_COUNT_VIEW)) {
      return NextResponse.json({ error: "Forbidden — INVENTORY_COUNT_VIEW permission required" }, { status: 403 });
    }

    const { id } = await params;
    const count = await getInventoryCountById(id);
    if (!count) {
      return NextResponse.json({ error: "Inventory count not found" }, { status: 404 });
    }

    return NextResponse.json(count);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch inventory count" }, { status: 500 });
  }
}
