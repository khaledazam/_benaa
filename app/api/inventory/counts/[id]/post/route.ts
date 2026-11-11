import { withWarehouseScope } from "@/lib/auth/warehouse-route-scope";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import { postInventoryCount } from "@/lib/inventory/countingService";

async function scopedPOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session ? mapSessionToAppUser(session) : null;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = user.role || "VIEWER";

    if (!hasPermission(user, BuildStockPermissions.INVENTORY_COUNT_POST)) {
      return NextResponse.json({ error: "Forbidden — INVENTORY_COUNT_POST permission required" }, { status: 403 });
    }

    const { id } = await params;
    const posted = await postInventoryCount(id, user.id);
    return NextResponse.json(posted);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to post inventory count" }, { status: 400 });
  }
}

export const POST = withWarehouseScope(scopedPOST);
