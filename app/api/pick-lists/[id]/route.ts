import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { getPickListById } from "@/lib/picking/pickingService";

async function scopedGET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    const role = user?.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.PICK_LIST_VIEW)) {
      return NextResponse.json({ error: "Forbidden: Insufficient permissions to view Pick List" }, { status: 403 });
    }

    const { id } = await context.params;
    const pickList = await getPickListById(id);

    if (!pickList) {
      return NextResponse.json({ error: "Pick List not found" }, { status: 404 });
    }

    return NextResponse.json(pickList);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch Pick List" }, { status: 500 });
  }
}

export const GET = withWarehouseScope(scopedGET);
